/**
 * Claude Code 进程启动器
 * 以 stream-json 模式启动 Claude Code，管理 stdin/stdout
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ClaudeProcess, SpawnOptions, ClaudeProcessEvent } from './types.js';

/**
 * 从 ~/.claude/settings.json 提取 MCP 服务器配置，
 * 写入 ~/.cc-remote/mcp-servers.json 供 --mcp-config 使用。
 * 结果缓存，仅首次调用时读取文件。
 */
let _mcpConfigPath: string | null | undefined;
function resolveMcpConfigPath(): string | null {
  if (_mcpConfigPath !== undefined) return _mcpConfigPath;

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    _mcpConfigPath = null;
    return null;
  }

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const servers = settings.servers;
    if (!servers || typeof servers !== 'object' || Object.keys(servers).length === 0) {
      _mcpConfigPath = null;
      return null;
    }

    const mcpConfig = { mcpServers: servers };
    const configDir = join(homedir(), '.cc-remote');
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

    const mcpConfigPath = join(configDir, 'mcp-servers.json');
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    _mcpConfigPath = mcpConfigPath;
    return mcpConfigPath;
  } catch {
    _mcpConfigPath = null;
    return null;
  }
}

/**
 * 行缓冲区，按 \n 拆分 stdout/stderr chunk
 * stream-json 模式下每行是一个完整 JSON 对象
 */
class LineBuffer {
  private buffer: string = '';

  constructor(private onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留未完成的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.onLine(trimmed);
      }
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      this.onLine(this.buffer.trim());
      this.buffer = '';
    }
  }
}

/**
 * Claude Code 进程包装器实现
 */
class ClaudeProcessImpl extends EventEmitter implements ClaudeProcess {
  public readonly pid: number;
  public readonly sessionId: string;
  public readonly process: ChildProcess;

  private _isRunning: boolean = true;
  private _printMode: boolean;
  private stdoutBuffer: LineBuffer;
  private stderrBuffer: LineBuffer;

  constructor(proc: ChildProcess, sessionId: string, printMode: boolean = false) {
    super();

    if (!proc.pid) {
      throw new Error('Claude Code 进程启动失败：无 PID');
    }

    this.pid = proc.pid;
    this.sessionId = sessionId;
    this.process = proc;
    this._printMode = printMode;

    // 初始化行缓冲区
    this.stdoutBuffer = new LineBuffer((line) => {
      this.emit('event', {
        type: 'stdout',
        data: line,
      } satisfies ClaudeProcessEvent);
    });

    this.stderrBuffer = new LineBuffer((line) => {
      this.emit('event', {
        type: 'stderr',
        data: line,
      } satisfies ClaudeProcessEvent);
    });

    this._setupEventHandlers();
  }

  /**
   * 设置进程事件处理器
   */
  private _setupEventHandlers(): void {
    // stdout 数据 — 使用行缓冲分帧
    this.process.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer.push(data.toString());
    });

    // stderr 数据 — 使用行缓冲分帧
    this.process.stderr?.on('data', (data: Buffer) => {
      this.stderrBuffer.push(data.toString());
    });

    // stdout/stderr 结束时 flush 剩余缓冲
    this.process.stdout?.on('end', () => {
      this.stdoutBuffer.flush();
    });

    this.process.stderr?.on('end', () => {
      this.stderrBuffer.flush();
    });

    // 进程退出
    this.process.on('exit', (code, signal) => {
      this._isRunning = false;
      this.emit('event', {
        type: 'exit',
        code,
        signal,
      } satisfies ClaudeProcessEvent);
    });

    // 进程错误
    this.process.on('error', (error) => {
      this.emit('event', {
        type: 'error',
        error,
      } satisfies ClaudeProcessEvent);
    });
  }

  /**
   * 发送用户消息到 stdin
   * --print 模式：发送纯文本后关闭 stdin（一次性命令）
   * 持续模式：发送 stream-json 格式（持久化进程）
   */
  sendMessage(message: string): void {
    if (!this._isRunning) {
      throw new Error('Claude Code 进程已停止');
    }

    if (!this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('Claude Code 进程 stdin 不可用');
    }

    if (this._printMode) {
      // --print 模式：纯文本 + stdin.end() 通知进程完成输入
      this.process.stdin.write(message + '\n', (err) => {
        if (err) {
          this.emit('event', {
            type: 'error',
            error: err,
          } satisfies ClaudeProcessEvent);
        }
      });
      this.process.stdin.end();
    } else {
      // 持续模式：stream-json input 格式（与 Claude stdout 输出格式一致）
      const payload = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: message }],
        },
      });

      this.process.stdin.write(payload + '\n', (err) => {
        if (err) {
          this.emit('event', {
            type: 'error',
            error: err,
          } satisfies ClaudeProcessEvent);
        }
      });
    }
  }

  /**
   * 中断当前生成（发送 SIGINT）
   */
  interrupt(): void {
    if (!this._isRunning) {
      return;
    }

    try {
      this.process.kill('SIGINT');
    } catch {
      // 进程已退出，忽略
    }
  }

  /**
   * 发送权限审批响应到 Claude Code stdin
   * 仅非 printMode 有效（printMode 下 stdin 在 sendMessage 后已关闭）
   */
  sendPermissionResponse(toolUseId: string, decision: 'allow' | 'deny' | 'allow_always'): void {
    if (!this._isRunning) {
      throw new Error('Claude Code 进程已停止，无法发送权限响应');
    }

    if (!this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('Claude Code 进程 stdin 不可用');
    }

    if (this._printMode) {
      throw new Error('printMode 不支持 sendPermissionResponse（stdin 已关闭）');
    }

    const payload = JSON.stringify({
      type: 'permission_response',
      tool_use_id: toolUseId,
      decision,
    });

    this.process.stdin.write(payload + '\n', (err) => {
      if (err) {
        this.emit('event', {
          type: 'error',
          error: err,
        } satisfies ClaudeProcessEvent);
      }
    });
  }

  sendToolResult(toolUseId: string, result: string): void {
    if (!this._isRunning) {
      throw new Error('Claude Code 进程已停止，无法发送工具结果');
    }

    if (!this.process.stdin || this.process.stdin.destroyed) {
      throw new Error('Claude Code 进程 stdin 不可用');
    }

    if (this._printMode) {
      throw new Error('printMode 不支持 sendToolResult（stdin 已关闭）');
    }

    // stream-json 格式：工具结果包裹在 user 消息内
    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: result,
        }],
      },
    });

    this.process.stdin.write(payload + '\n', (err) => {
      if (err) {
        this.emit('event', {
          type: 'error',
          error: err,
        } satisfies ClaudeProcessEvent);
      }
    });
  }

  /**
   * 优雅关闭（等待当前操作完成）
   */
  async gracefulShutdown(timeoutMs: number = 5000): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    // 发送 SIGTERM
    try {
      this.process.kill('SIGTERM');
    } catch {
      // 进程已退出
      return;
    }

    // 等待进程退出，超时后 fallback 到 SIGKILL
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        try {
          this.process.kill('SIGKILL');
        } catch {
          // 进程已退出
        }
        resolve();
      }, timeoutMs);

      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * 强制关闭
   */
  forceShutdown(): void {
    if (!this._isRunning) {
      return;
    }

    try {
      this.process.kill('SIGKILL');
    } catch {
      // 进程已退出，忽略
    }
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this._isRunning;
  }
}

/**
 * Claude Code 进程启动器
 */
export class ClaudeSpawner {
  /**
   * 以 stream-json 模式启动 Claude Code
   */
  spawn(options: SpawnOptions): ClaudeProcess {
    const { sessionId, projectPath, model, resume, resumePrint, allowedTools, env } = options;

    if (!sessionId || sessionId.trim() === '') {
      throw new Error('sessionId 不能为空');
    }

    let args: string[];
    let printMode = false;

    if (resume) {
      // --resume 恢复已有会话。支持两种模式：
      //   print 模式：-p --resume（stdin 关闭后退出，用于独立消息）
      //   TUI 模式：--resume 无 -p（stdin 保持开放，用于接管/全控制）
      const usePrintMode = resumePrint !== false;
      if (usePrintMode) {
        args = [
          '-p',
          '--resume', sessionId,
          '--output-format', 'stream-json',
          '--verbose',
          '--permission-mode', 'bypassPermissions',
        ];
        printMode = true;
      } else {
        args = [
          '--resume', sessionId,
          '--output-format', 'stream-json',
          '--verbose',
          '--input-format', 'stream-json',
        ];
      }

      // -p 模式默认跳过 MCP 初始化，通过 --mcp-config 显式加载
      const mcpConfigPath = resolveMcpConfigPath();
      if (mcpConfigPath) {
        args.push('--mcp-config', mcpConfigPath);
      }
    } else {
      // 非 resume（创建新会话/持续对话模式），remote 默认绕过权限
      args = [
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--input-format', 'stream-json',
        '--session-id', sessionId,
      ];
    }

    // --resume 模式会从会话元数据中恢复模型，无需显式传入 --model
    // 显式传入反而可能因模型名不被当前版本识别而导致冲突警告
    if (model && !resume) {
      args.push('--model', model);
    }

    if (allowedTools && allowedTools.length > 0) {
      args.push('--allowedTools', ...allowedTools);
    }

    // 启动进程
    const proc = spawn('claude', args, {
      cwd: projectPath || process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new ClaudeProcessImpl(proc, sessionId, printMode);
  }
}

// 导出单例
export const claudeSpawner = new ClaudeSpawner();
