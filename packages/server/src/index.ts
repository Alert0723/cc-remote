/**
 * CC Remote Server 入口
 */

import { createInterface } from 'readline';
import { watch } from 'chokidar';
import { sessionManager } from './session/manager.js';
import { createServerEvent } from '@cc-remote/shared';
import { showConnectionQR } from './discovery/qrcode.js';
import { bootstrap, getAuthToken } from './bootstrap.js';
import type { ServerContext } from './bootstrap.js';
import type { CCWebSocketServer } from './ws/server.js';

async function main() {
  const port = 8420;
  const isAttachMode = process.argv.includes('--attach-mode');

  // --shutdown 模式：发送关闭请求到运行中的服务端
  if (process.argv.includes('--shutdown')) {
    await shutdownRemote(getAuthToken(), port);
    return;
  }

  // 启动核心组件（HTTP → WS → SessionManager 注入）
  const ctx = await bootstrap(port);

  // 注册信号处理器
  setupGracefulShutdown(ctx);

  // 尝试恢复上次保存的会话状态（热重启用）
  const restoredCount = await sessionManager.restoreState();
  if (restoredCount > 0) {
    console.log(`[Restore] 已恢复 ${restoredCount} 个会话`);
  }

  // 显示连接信息
  showStartupInfo(isAttachMode, port, ctx.authToken);

  // 启动后台服务
  sessionManager.startHeartbeat();
  sessionManager.startAutoCleanup();
  startAutoRestart(port, ctx.authToken);
  startConsoleListener(ctx.ws);
}

/**
 * 显示启动信息（QR 码 / 恢复的会话列表）
 */
function showStartupInfo(isAttachMode: boolean, port: number, token: string): void {
  if (isAttachMode) {
    console.log(`[Attach Mode] 服务已启动，请在手机端选择会话\n`);
    showConnectionQR(port, token);
    console.log('');

    const currentSessions = sessionManager.getSessions();
    if (currentSessions.length > 0) {
      console.log(`已恢复 ${currentSessions.length} 个会话：`);
      for (const s of currentSessions) {
        console.log(`  ${s.id.slice(0, 8)} ${s.status} ${s.projectPath || ''}`);
      }
    } else {
      console.log('暂无已连接会话，请在手机端选择或创建');
    }
  } else {
    showConnectionQR(port, token);
    console.log('服务已启动，等待连接...\n');
  }
}

/**
 * 注册优雅关闭处理器
 */
function setupGracefulShutdown(ctx: ServerContext): void {
  let shuttingDown = false;

  const gracefulShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n正在关闭 CC Remote...');

    const timer = setTimeout(() => {
      console.error('[Shutdown] 超时 5s，强制退出');
      process.exit(1);
    }, 5000);
    timer.unref?.();

    sessionManager.saveState()
      .then((savedCount) => {
        console.log(`[Shutdown] 已保存 ${savedCount} 个会话状态`);
        return sessionManager.closeAll();
      })
      .catch((err) => {
        console.error('[Shutdown] 保存状态失败:', err);
      })
      .finally(() => {
        clearTimeout(timer);
        ctx.ws.close();
        ctx.http.close().catch(() => {});
        console.log('CC Remote 已关闭');
        process.exit(0);
      });
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

/**
 * 向已运行的 CC Remote 服务发送关闭请求
 */
async function shutdownRemote(token: string, port: number): Promise<void> {
  const http = await import('http');
  const postData = JSON.stringify({});
  const options = {
    hostname: 'localhost',
    port,
    path: '/api/shutdown',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      Authorization: `Bearer ${token}`,
    },
    timeout: 5000,
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk.toString());
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(JSON.stringify({ status: 'ok', message: '服务器已关闭', detail: result }));
        } catch {
          // 响应非 JSON（服务器可能在发送响应前已退出）
          console.log(JSON.stringify({ status: 'ok', message: '服务器已关闭' }));
        }
        resolve();
      });
    });
    req.on('error', (err: any) => {
      if (err.code === 'ECONNREFUSED') {
        console.log(JSON.stringify({ status: 'ok', message: '服务器未在运行' }));
        resolve();
      } else {
        console.log(JSON.stringify({ status: 'error', message: `关闭失败: ${err.message}` }));
        reject(err);
      }
    });
    req.on('timeout', () => {
      req.destroy();
      console.log(JSON.stringify({ status: 'error', message: '关闭请求超时' }));
      reject(new Error('timeout'));
    });
    req.write(postData);
    req.end();
  });
}

/**
 * 启动控制台命令监听
 */
function startConsoleListener(ws: CCWebSocketServer): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  if (process.stdout.isTTY) {
    rl.setPrompt('cc-remote> ');
  }

  setTimeout(() => {
    if (process.stdout.isTTY) {
      rl.prompt();
    }
  }, 500);

  rl.on('line', async (line: string) => {
    const cmd = line.trim().toLowerCase();

    if (cmd === 'restart' || cmd === 'rs') {
      console.log('\n[Console] 正在热重启...');
      const savedCount = await sessionManager.saveState();
      ws.broadcast(createServerEvent('restart_notice', {
        message: '服务器正在重启，客户端将自动重连',
        savedSessions: savedCount,
      }));
      setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 200);
    } else if (cmd === 'help' || cmd === 'h') {
      console.log('');
      console.log('  可用命令：');
      console.log('    restart / rs  热重启服务（保存状态后重启）');
      console.log('    quit / q      优雅关闭服务');
      console.log('    sessions      列出当前已连接会话');
      console.log('    help / h      显示此帮助');
      console.log('');
    } else if (cmd === 'quit' || cmd === 'q') {
      console.log('\n[Console] 正在关闭...');
      rl.close();
      process.kill(process.pid, 'SIGINT');
    } else if (cmd === 'sessions') {
      const sessions = sessionManager.getSessions();
      if (sessions.length === 0) {
        console.log('  暂无已连接会话');
      } else {
        console.log(`  已连接 ${sessions.length} 个会话：`);
        for (const s of sessions) {
          console.log(`    ${s.id.slice(0, 8)}  ${s.status.padEnd(18)} ${s.projectPath || ''}`);
        }
      }
    } else if (cmd) {
      console.log(`  未知命令: ${cmd}（输入 help 查看可用命令）`);
    }

    if (process.stdout.isTTY) {
      rl.prompt();
    }
  });
}

// ── 全局异常保护 ──
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled Rejection:', reason);
});

/**
 * 监听构建输出变更，自动热重启
 */
function startAutoRestart(port: number, token: string) {
  const watcher = watch(import.meta.dirname, {
    ignoreInitial: true,
    ignored: ['**/*.map', '**/*.d.ts', '**/*.d.mts'],
    depth: 2,
    persistent: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watcher.on('change', (filePath: string) => {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.mjs')) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log('[AutoRestart] 检测到 dist 变更，自动热重启...');

      const watchdog = setTimeout(() => {
        console.error('[AutoRestart] 看门狗超时 30s，强制退出');
        process.exit(1);
      }, 30_000);
      watchdog.unref?.();

      try {
        await httpRestartWithRetry(port, token);
        clearTimeout(watchdog);
      } catch (err) {
        console.error('[AutoRestart] 10 次重试均失败，降级到 process.exit:', (err as Error).message);
        try { await sessionManager.saveState(); } catch { /* 降级退出，状态丢失可接受 */ }
        process.exit(1);
      }
    }, 2000);
  });
}

/** 通过 HTTP 调用自身的 restart 端点触发重启 */
async function httpRestart(port: number, token: string) {
  const res = await fetch(`http://localhost:${port}/api/restart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** HTTP 热重启 + 重试 */
async function httpRestartWithRetry(port: number, token: string, maxRetries = 10) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      await sessionManager.saveState();
      await httpRestart(port, token);
      if (i > 0) console.log(`[AutoRestart] 第 ${i + 1} 次尝试成功`);
      return;
    } catch (err) {
      if (i < maxRetries) {
        console.warn(`[AutoRestart] 第 ${i + 1} 次失败，5s 后重试:`, (err as Error).message);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        throw err;
      }
    }
  }
}

main().catch(console.error);
