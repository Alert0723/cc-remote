/**
 * JSONL 文件监听器
 * 使用 chokidar 监听 JSONL 文件追加，实时推送新消息
 */

import { EventEmitter } from 'events';
import { statSync, openSync, readSync, closeSync } from 'fs';
import { watch } from 'chokidar';
import type { HistoryMessage } from '@cc-remote/shared';
import type { JsonlLine, JsonlUserMessage, JsonlAssistantMessage, JsonlSystemMessage } from './types.js';

/**
 * JSONL 文件监听器事件映射
 */
export interface JsonlWatcherEvents {
  newMessages: (messages: HistoryMessage[]) => void;
  /** 检测到一轮对话完成（system/subtype=turn_duration），表示 LLM 调用结束 */
  turnComplete: () => void;
  /** JSONL 文件被清空或重置（如 /clear 命令） */
  fileReset: () => void;
  error: (error: Error) => void;
}

/**
 * JSONL 文件监听器
 */
export class JsonlWatcher extends EventEmitter {
  private watcher: ReturnType<typeof watch> | null = null;
  private lastSize: number = 0;
  private lineBuffer: string = '';

  constructor(private jsonlPath: string) {
    super();
  }

  /**
   * 开始监听
   */
  start(): void {
    // 记录当前文件大小
    try {
      const stats = statSync(this.jsonlPath);
      this.lastSize = stats.size;
    } catch {
      // JSONL 文件尚不存在（新会话），从 0 开始监听
      this.lastSize = 0;
    }

    // 使用 chokidar 监听文件变化
    // usePolling 确保 Windows 上可靠感知文件变更
    // stabilityThreshold 100ms 降低远程端感知延迟
    this.watcher = watch(this.jsonlPath, {
      persistent: true,
      ignoreInitial: true,
      usePolling: true,
      interval: 50,
      // 不启用 awaitWriteFinish，避免工具调用被批量捆绑推送
      // lineBuffer 机制已处理部分写入的行，不会产生截断
    });

    this.watcher.on('change', () => {
      this._readNewLines();
    });

    this.watcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * 读取新增行
   */
  private _readNewLines(): void {
    try {
      const stats = statSync(this.jsonlPath);
      // 文件被清空或缩小（如 /clear 命令），重置状态并通知外部重载
      if (stats.size < this.lastSize) {
        this.lastSize = 0;
        this.lineBuffer = '';
        this.emit('fileReset');
        return;
      }
      if (stats.size <= this.lastSize) return;

      // 增量读取：只读新增字节，try-finally 确保文件描述符释放
      const delta = stats.size - this.lastSize;
      const fd = openSync(this.jsonlPath, 'r');
      let newContent: string;
      try {
        const buf = Buffer.alloc(delta);
        readSync(fd, buf, 0, delta, this.lastSize);
        newContent = buf.toString('utf-8');
      } finally {
        closeSync(fd);
      }
      this.lastSize = stats.size;

      // 处理可能被截断的 UTF-8 多字节字符：
      // 若末尾为不完整序列，回退 lastSize 让下次读取重新包含这些字节
      if (newContent.length > 0) {
        const lastCharCode = newContent.charCodeAt(newContent.length - 1);
        if (lastCharCode >= 0x80) {
          let seqStart = newContent.length - 1;
          while (seqStart > 0 && newContent.charCodeAt(seqStart) >= 0x80) {
            seqStart--;
          }
          const firstByte = newContent.charCodeAt(seqStart);
          const expectedLen =
            firstByte < 0xC0 ? 1 :
            firstByte < 0xE0 ? 2 :
            firstByte < 0xF0 ? 3 : 4;
          const actualLen = newContent.length - seqStart;
          if (actualLen < expectedLen) {
            // 不完整 UTF-8 序列：截断内容并回退 lastSize
            newContent = newContent.slice(0, seqStart);
            this.lastSize -= (delta - seqStart);
          }
        }
      }

      // 处理行缓冲
      this.lineBuffer += newContent;
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() || '';  // 保留未完成的行

      // 解析新增行
      const newMessages: HistoryMessage[] = [];
      let hasTurnComplete = false;

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as JsonlLine;

          // turn_duration / result 可能带有 isMeta:true，必须优先检测
          if ((parsed.type === 'system' && (parsed as JsonlSystemMessage).subtype === 'turn_duration') || (parsed.type === 'result' && parsed.subtype === 'success')) {
            hasTurnComplete = true;
            continue;
          }

          if (parsed.isMeta || parsed.isSidechain) continue;

          if (parsed.type === 'user' && 'message' in parsed) {
            const userMsg = parsed as JsonlUserMessage;
            const content = userMsg.message.content;

            if (typeof content === 'string' && content.trim()) {
              newMessages.push({
                id: parsed.uuid,
                role: 'user',
                content,
                timestamp: parsed.timestamp,
              });
            } else if (Array.isArray(content)) {
              // 提取 tool_results（后续作为独立的 tool_result 事件广播）
              const toolResults = content
                .filter(b => b.type === 'tool_result')
                .map(b => ({
                  toolUseId: (b as { type: 'tool_result'; tool_use_id: string }).tool_use_id,
                  content: typeof (b as { content: unknown }).content === 'string'
                    ? (b as { content: string }).content
                    : JSON.stringify((b as { content: unknown }).content),
                  isError: (b as { is_error?: boolean }).is_error,
                }));

              const textParts = content
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; text: string }).text);

              if (textParts.length > 0 || toolResults.length > 0) {
                newMessages.push({
                  id: parsed.uuid,
                  role: 'user',
                  content: textParts.join('\n'),
                  timestamp: parsed.timestamp,
                  toolResults: toolResults.length > 0 ? toolResults : undefined,
                });
              }
            }
          }

          if (parsed.type === 'assistant' && 'message' in parsed) {
            const assistantMsg = parsed as JsonlAssistantMessage;
            const blocks = assistantMsg.message.content;

            if (Array.isArray(blocks)) {
              const textParts = blocks
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; text: string }).text);

              const toolCalls = blocks
                .filter(b => b.type === 'tool_use')
                .map(b => ({
                  id: (b as { type: 'tool_use'; id: string }).id,
                  name: (b as { type: 'tool_use'; name: string }).name,
                  input: (b as { type: 'tool_use'; input: Record<string, unknown> }).input,
                }));

              const text = textParts.join('\n');
              if (text || toolCalls.length > 0) {
                newMessages.push({
                  id: parsed.uuid,
                  role: 'assistant',
                  content: text,
                  timestamp: parsed.timestamp,
                  toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                });
              }
            }
          }
        } catch {
          // 跳过解析失败的行
        }
      }

      if (newMessages.length > 0) {
        this.emit('newMessages', newMessages);
      }

      if (hasTurnComplete) {
        this.emit('turnComplete');
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * 停止监听
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
