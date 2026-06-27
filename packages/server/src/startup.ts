/**
 * CC Remote 一键启动脚本
 * 合并所有启动步骤，输出 JSON 结果，最大限度减少 Claude 交互轮次
 *
 * 输出 JSON:
 *   {"status":"ok","url":"...","sessionId":"...","message":"..."}
 *   {"status":"error","message":"..."}
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, openSync, writeSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { homedir, networkInterfaces } from 'os';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = 8420;
const CONFIG_DIR = join(homedir(), '.cc-remote');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const LOG_FILE = join(CONFIG_DIR, 'server.log');

// ─── 工具函数 ───────────────────────────────────────────

function output(result: Record<string, unknown>): never {
  const msg = JSON.stringify(result) + '\n';
  // 使用 writeSync 同步写入，确保输出在 process.exit() 前刷新到终端
  // console.log 是异步的，配合 process.exit() 在双击 CMD 窗口时可能丢失输出 → 闪退
  writeSync(result.status === 'ok' ? 1 : 2, msg);
  process.exit(result.status === 'ok' ? 0 : 1);
}

/**
 * 获取命令行参数中指定 flag 的值
 * 示例：process.argv 包含 ['--session-id', 'abc123'] → getArgValue('--session-id') 返回 'abc123'
 */
function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const val = process.argv[idx + 1];
    // 防止把下一个 flag 当成值
    if (val.startsWith('--')) return undefined;
    return val;
  }
  return undefined;
}

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isSpecialPurposeIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 169 && b === 254) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function getLocalIP(): string | null {
  const nets = networkInterfaces();
  let fallback: string | null = null;
  for (const name of Object.keys(nets)) {
    const netArray = nets[name];
    if (!netArray) continue;
    for (const net of netArray) {
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;
      if (isSpecialPurposeIPv4(net.address)) continue;

      if (isPrivateIPv4(net.address)) {
        return net.address;
      }
      if (!fallback) {
        fallback = net.address;
      }
    }
  }
  return fallback;
}

function getOrGenerateToken(): string {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.token) return config.token;
    } catch { /* 配置文件损坏，重新生成 */ }
  }

  const token = randomUUID();
  writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2));
  return token;
}

// ─── HTTP 请求工具 ──────────────────────────────────────

function httpPost(url: string, body: object, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk.toString());
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(postData);
    req.end();
  });
}

// ─── 步骤函数 ───────────────────────────────────────────

/**
 * 检查 server 是否已运行
 */
function isServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: 3000 }, () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * 关闭已运行的旧服务
 */
async function shutdownExisting(): Promise<void> {
  const token = getOrGenerateToken();
  try {
    await httpPost(
      `http://localhost:${PORT}/api/shutdown`,
      {},
      { Authorization: `Bearer ${token}` }
    );
    // 等一等让旧服务完全退出（含状态保存 + closeAll + ws/http close）
    await new Promise(r => setTimeout(r, 3000));
  } catch {
    // 旧服务可能已停止，忽略错误
  }
}

/**
 * 获取所有有效会话条目（按文件名倒序，最新优先）
 */
function getSessionEntries(): { sessionId: string; cwd: string }[] {
  const sessionsDir = join(homedir(), '.claude', 'sessions');
  if (!existsSync(sessionsDir)) return [];

  try {
    const results: { sessionId: string; cwd: string }[] = [];
    const files = readdirSync(sessionsDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8'));
        if (data.sessionId) {
          results.push({ sessionId: data.sessionId, cwd: data.cwd || '?' });
        }
      } catch { /* 跳过损坏的文件 */ }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 按编号获取会话 ID（1-based，与 listSessions 输出一致）
 */
function getSessionByIndex(indexStr: string): string | null {
  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 1) return null;
  const entries = getSessionEntries();
  if (index > entries.length) return null;
  return entries[index - 1].sessionId;
}

/**
 * 获取当前 Claude Code 会话 ID（自动取最新一个）
 */
function getSessionId(): string | null {
  const entries = getSessionEntries();
  return entries.length > 0 ? entries[0].sessionId : null;
}

/**
 * 列出所有可用会话（供 bat 提示用）
 */
function listSessions(): void {
  const entries = getSessionEntries();
  if (entries.length === 0) {
    console.log('  (无可用会话)');
    return;
  }
  entries.forEach((e, i) => {
    console.log(`  [${i + 1}]  ${e.sessionId}  |  ${e.cwd}`);
  });
}

/**
 * 启动 server
 * @param mode 'new-window'=独立可见窗口 | 'foreground'=当前窗口前台
 */
function startServer(mode: 'new-window' | 'foreground'): ReturnType<typeof spawn> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const serverPath = join(__dirname, 'index.js');
  const logFd = openSync(LOG_FILE, 'a');

  // new-window 模式：用 shell 模式 spawn，通过 start 命令打开独立可见 cmd 窗口
  if (mode === 'new-window') {
    const cmd = `start "CC Remote" node "${serverPath}" --attach-mode`;
    const child = spawn(cmd, [], {
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return child;
  }

  // 前台模式：所有 stdio 继承到当前终端，支持 Ctrl+C 和控制台命令（restart/quit）
  const child = spawn('node', [serverPath, '--attach-mode'], {
    detached: false,
    stdio: 'inherit',
    windowsHide: false,
  });

  return child;
}

/**
 * 等待 server 启动就绪
 */
async function waitForServer(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ─── 关闭远程服务 ──────────────────────────────────────

async function shutdownRemote(): Promise<void> {
  const running = await isServerRunning();
  if (!running) {
    output({ status: 'ok', message: '服务器未在运行' });
  }

  try {
    const token = getOrGenerateToken();
    const result = await httpPost(
      `http://localhost:${PORT}/api/shutdown`,
      {},
      { Authorization: `Bearer ${token}` }
    );
    output({ status: 'ok', message: '服务器已关闭' });
  } catch (err: any) {
    output({ status: 'error', message: `关闭失败: ${err.message}` });
  }
}

// ─── 主流程 ─────────────────────────────────────────────

async function main() {
  // --shutdown 模式：关闭远程服务
  if (process.argv.includes('--shutdown')) {
    await shutdownRemote();
    return;
  }

  const isNewWindow = process.argv.includes('--new-window');
  const mode: 'new-window' | 'foreground' =
    isNewWindow ? 'new-window' : 'foreground';

  // 1. 获取 token
  const token = getOrGenerateToken();
  const ip = getLocalIP();
  if (!ip) {
    output({ status: 'error', message: '无法获取局域网 IP 地址' });
  }

  // 2. 若旧服务在运行，先自动关闭
  const wasRunning = await isServerRunning();
  if (wasRunning) {
    await shutdownExisting();
  }

  // 3. 启动服务
  let serverChild = startServer(mode);
  const ready = await waitForServer();
  if (!ready) {
    output({ status: 'error', message: '服务启动超时，请检查日志' });
  }

  // 4. 输出结果（会话选择改为在手机 UI 中完成）
  const url = `http://${ip}:${PORT}?server=http://${ip}:${PORT}&token=${token}`;
  const result = {
    status: 'ok' as const,
    url,
    message: `CC Remote 已启动，请在手机端选择要连接的会话。`,
  };

  if (isNewWindow) {
    // 新窗口模式：输出 JSON 后立即退出（一次性启动，不支持自动重新拉起）
    output(result);
  }

  // 前台模式：热重启循环
  // 服务退出后检测 state.json 更新时间，若为热重启则自动重新拉起
  let firstRun = true;
  while (true) {
    // 非首次运行时：重新启动服务
    if (!firstRun) {
      const stillRunning = await isServerRunning();
      if (stillRunning) {
        await shutdownExisting();
      }
      const newChild = startServer(mode);
      const newReady = await waitForServer();
      if (!newReady) {
        console.error('[Startup] 服务重启超时');
        break;
      }
      serverChild = newChild;
    }

    if (firstRun) {
      console.log(JSON.stringify(result));
      console.log('');
      console.log(`连接地址: ${url}`);
      console.log('');
      console.log('输入 help 查看可用命令');
      console.log('');
      firstRun = false;
    } else {
      console.log(`\n[Startup] 服务已重新启动 (${new Date().toLocaleTimeString()})`);
      console.log(`连接地址: ${url}\n`);
    }

    // 等待服务进程结束
    const exitCode = await new Promise<number>((resolve) => {
      serverChild.on('exit', (code) => resolve(code || 0));
    });

    // 检测是否为热重启（state.json 在 5 秒内被更新过）
    const statePath = join(CONFIG_DIR, 'state.json');
    let isRestart = false;
    try {
      const stats = statSync(statePath);
      isRestart = (Date.now() - stats.mtimeMs) < 5000;
    } catch {
      // state.json 不存在 → 非重启
    }

    if (!isRestart) {
      console.log('[Startup] 服务已关闭');
      break;
    }

    console.log('[Startup] 检测到热重启信号，正在重新启动服务...');
  }
}

main().catch((err) => {
  output({ status: 'error', message: `启动失败: ${err.message}` });
});
