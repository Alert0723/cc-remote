/**
 * Claude Code 进程相关类型定义
 */

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

/**
 * Claude Code 进程启动选项
 */
export interface SpawnOptions {
  sessionId: string;
  projectPath?: string;
  model?: string;
  resume?: boolean;
  /** --resume 时使用 print 模式（-p，stdin 关闭后退出），默认 true */
  resumePrint?: boolean;
  allowedTools?: string[];
  env?: Record<string, string>;
}

/**
 * Claude Code 进程包装器
 * 实现 ClaudeProcessEvent 的事件发射能力
 */
export interface ClaudeProcess {
  pid: number;
  sessionId: string;
  process: ChildProcess;

  /**
   * 监听进程事件
   */
  on(event: 'event', listener: (event: ClaudeProcessEvent) => void): this;

  /**
   * 发送用户消息到 stdin
   */
  sendMessage(message: string): void;

  /**
   * 中断当前生成（发送 SIGINT）
   */
  interrupt(): void;

  /**
   * 发送权限审批响应到 Claude Code stdin
   * @param toolUseId Claude 权限请求中的 tool_use_id
   * @param decision 审批决策：allow / deny / allow_always
   */
  sendPermissionResponse(toolUseId: string, decision: 'allow' | 'deny' | 'allow_always'): void;

  /**
   * 发送工具结果到 Claude Code stdin（用于 AskUserQuestion 回复）
   */
  sendToolResult(toolUseId: string, result: string): void;

  /**
   * 优雅关闭（等待当前操作完成）
   */
  gracefulShutdown(timeoutMs?: number): Promise<void>;

  /**
   * 强制关闭
   */
  forceShutdown(): void;

  /**
   * 是否正在运行
   */
  isRunning(): boolean;
}

/**
 * Claude Code 进程事件
 */
export type ClaudeProcessEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; error: Error };

export type { StreamParserOptions } from './stream-parser.js';
