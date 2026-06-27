/**
 * 状态持久化模块
 * 负责会话状态的磁盘保存与恢复，支撑热重启功能
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionInfo, HistoryMessage, ServerEvent } from '@cc-remote/shared';

/** 状态文件路径 */
const STATE_FILE = join(homedir(), '.cc-remote', 'state.json');

/** 状态文件格式版本（向前兼容用） */
const STATE_VERSION = 1;

// ============ 持久化类型 ============

/**
 * 单个会话的持久化快照
 */
export interface PersistedSession {
  info: SessionInfo;
  /** attach 模式的 JSONL 文件路径（恢复时用于重新挂载 watcher） */
  jsonlPath?: string;
  /** spawn 模式的缓存消息快照（进程退出后无法从 stdout 恢复） */
  historyMessages?: HistoryMessage[];
}

/**
 * RingBuffer 事件的持久化格式（仅保留关键字段）
 */
export interface PersistedEvent {
  type: string;
  seq: number;
  ts: number;
  sessionId?: string;
  data: unknown;
}

/**
 * 完整状态文件格式
 */
export interface PersistedState {
  version: number;
  sessions: PersistedSession[];
  bufferEvents: PersistedEvent[];
  lastSeq: number;
  savedAt: number;
}

// ============ 文件 I/O ============

/**
 * 保存状态到磁盘
 * @returns 保存的会话数量
 */
export function saveStateFile(
  sessions: PersistedSession[],
  bufferEvents: ServerEvent[],
  lastSeq: number
): number {
  const state: PersistedState = {
    version: STATE_VERSION,
    sessions,
    // 精简事件字段，控制文件大小
    bufferEvents: bufferEvents.map((e) => ({
      type: e.type,
      seq: e.seq,
      ts: e.ts,
      sessionId: e.sessionId,
      data: (e as unknown as Record<string, unknown>).data,
    })),
    lastSeq,
    savedAt: Date.now(),
  };

  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return sessions.length;
}

/**
 * 从磁盘加载状态
 * @returns 解析后的状态，或 null（文件不存在/格式不兼容/损坏）
 */
export function loadStateFile(): PersistedState | null {
  if (!existsSync(STATE_FILE)) return null;

  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw) as PersistedState;

    if (!state || typeof state.version !== 'number' || state.version !== STATE_VERSION) {
      console.warn('[Persist] state.json 版本不兼容，忽略');
      return null;
    }

    if (!Array.isArray(state.sessions)) {
      console.warn('[Persist] state.json 格式异常（缺少 sessions 数组），忽略');
      return null;
    }

    return state;
  } catch (err) {
    console.warn(`[Persist] state.json 读取失败: ${(err as Error).message}`);
    return null;
  }
}
