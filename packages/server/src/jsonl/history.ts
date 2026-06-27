/**
 * JSONL 历史读取器
 * 解析 Claude Code 的 JSONL 文件，提取完整对话上下文
 */

import { readFile } from 'fs/promises';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { HistoryMessage } from '@cc-remote/shared';
import type { JsonlLine, JsonlUserMessage, JsonlAssistantMessage } from './types.js';

/**
 * JSONL 历史读取器
 */
export class JsonlHistory {
  /**
   * 根据 sessionId 构建 JSONL 文件路径
   */
  static resolveJsonlPath(sessionId: string, projectPath?: string): string | null {
    const claudeDir = join(homedir(), '.claude', 'projects');

    if (projectPath) {
      // 编码项目路径为目录名（与 Claude Code 的编码保持一致）：
      //   Unix:    /Users/xxx/proj → -Users-xxx-proj
      //   Windows: C:\Users\xxx\proj → C--Users-xxx-proj
      const encoded = projectPath.replace(/[\/\\:]/g, '-');
      const candidate = join(claudeDir, encoded, `${sessionId}.jsonl`);

      // 确保项目目录存在（为新会话创建目录）
      const projectDir = join(claudeDir, encoded);
      if (!existsSync(projectDir)) {
        try { mkdirSync(projectDir, { recursive: true }); } catch {}
      }

      if (existsSync(candidate)) return candidate;

      // JSONL 尚未创建，但返回预判路径（Watcher 会在文件创建后开始监听）
      console.log(`[JsonlHistory] JSONL 尚不存在，返回预判路径: ${candidate}`);
      return candidate;
    }

    // 无 projectPath：遍历所有项目目录查找已有 JSONL
    if (existsSync(claudeDir)) {
      try {
        const projectDirs = readdirSync(claudeDir, { withFileTypes: true });
        for (const dir of projectDirs) {
          if (!dir.isDirectory()) continue;
          const candidate = join(claudeDir, dir.name, `${sessionId}.jsonl`);
          if (existsSync(candidate)) return candidate;
        }
      } catch (err) {
        console.error(`[JsonlHistory] 遍历项目目录失败 (${claudeDir}):`, (err as Error).message);
      }
    }

    console.error(`[JsonlHistory] 找不到会话 ${sessionId.slice(0, 8)} 的 JSONL: projectPath="${projectPath}", claudeDir="${claudeDir}"`);
    return null;
  }

  /**
   * 读取完整的对话历史
   */
  static async read(jsonlPath: string): Promise<HistoryMessage[]> {
    if (!existsSync(jsonlPath)) {
      return [];
    }

    const content = await readFile(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    const messages: HistoryMessage[] = [];
    const toolResults = new Map<string, { result: string; isError?: boolean }>();

    // 第一遍：收集 tool_result
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as JsonlLine;

        if (parsed.isMeta || parsed.isSidechain) continue;

        if (parsed.type === 'user' && 'message' in parsed) {
          const userMsg = parsed as JsonlUserMessage;
          const contentBlocks = userMsg.message.content;

          if (Array.isArray(contentBlocks)) {
            for (const block of contentBlocks) {
              if (block.type === 'tool_result') {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                toolResults.set(block.tool_use_id, {
                  result: resultText,
                  isError: block.is_error,
                });
              }
            }
          }
        }
      } catch {
        // 跳过解析失败的行
      }
    }

    // 第二遍：提取 user 和 assistant 消息
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as JsonlLine;

        if (parsed.isMeta || parsed.isSidechain) continue;

        if (parsed.type === 'user' && 'message' in parsed) {
          const userMsg = parsed as JsonlUserMessage;
          const content = userMsg.message.content;

          // 跳过纯 tool_result 类型的 user 消息（已关联到 tool_use）
          if (Array.isArray(content)) {
            const hasOnlyToolResults = content.every(b => b.type === 'tool_result');
            if (hasOnlyToolResults) continue;

            // 提取非 tool_result 的文本
            const textParts = content
              .filter(b => b.type === 'text')
              .map(b => (b as { type: 'text'; text: string }).text);

            if (textParts.length > 0) {
              messages.push({
                id: parsed.uuid,
                role: 'user',
                content: textParts.join('\n'),
                timestamp: parsed.timestamp,
              });
            }
          } else if (typeof content === 'string' && content.trim()) {
            messages.push({
              id: parsed.uuid,
              role: 'user',
              content,
              timestamp: parsed.timestamp,
            });
          }
        }

        if (parsed.type === 'assistant' && 'message' in parsed) {
          const assistantMsg = parsed as JsonlAssistantMessage;
          const contentBlocks = assistantMsg.message.content;

          if (!Array.isArray(contentBlocks)) continue;

          // 提取文本内容
          const textParts: string[] = [];
          const toolCalls: HistoryMessage['toolCalls'] = [];

          for (const block of contentBlocks) {
            if (block.type === 'text') {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              const toolResult = toolResults.get(block.id);
              toolCalls.push({
                id: block.id,
                name: block.name,
                input: block.input,
                result: toolResult?.result,
                isError: toolResult?.isError,
              });
            }
            // thinking 类型跳过
          }

          const text = textParts.join('\n');

          if (text || toolCalls.length > 0) {
            messages.push({
              id: parsed.uuid,
              role: 'assistant',
              content: text,
              timestamp: parsed.timestamp,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      } catch {
        // 跳过解析失败的行
      }
    }

    return messages;
  }
}
