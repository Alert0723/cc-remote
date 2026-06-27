/**
 * Claude Code stream-json 输出解析器
 * 将 stdout 的 JSON 行转换为标准化的 ServerEvent
 */

import type { ServerEvent, StreamEvent, ApprovalRequest, QuestionRequest } from '@cc-remote/shared';
import { generateId } from '@cc-remote/shared';

/**
 * Claude Code 原始输出格式（简化版）
 * 实际格式可能更复杂，这里只提取关键字段
 */
interface RawStreamEvent {
  type: string;
  content?: string | Array<{ type: string; text?: string }>;
  /** --verbose 模式：content 嵌套在 message 对象内 */
  message?: {
    id?: string;
    content?: Array<{ type: string; text?: string; thinking?: string }>;
  };
  tool_use_id?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: string;
  is_error?: boolean;
  subtype?: string;
  cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  session_id?: string;
  /** permission_request 事件特定字段 */
  options?: string[];
  arguments?: Record<string, unknown>;
  prompt?: string;
  // 其他字段忽略
}

/**
 * Stream Parser 配置
 */
export interface StreamParserOptions {
  sessionId?: string;
  onError?: (error: Error, rawLine: string) => void;
}

/**
 * Stream Parser
 * 将 Claude Code 的 stream-json 输出转换为 ServerEvent
 */
export class StreamParser {
  private seq: number = 0;
  /** 待输出的工具调用事件队列（从 assistant 消息中提取的 tool_use 块） */
  private _pendingToolEvents: ServerEvent[] = [];
  private sessionId?: string;
  private onError?: (error: Error, rawLine: string) => void;

  constructor(options: StreamParserOptions = {}) {
    this.sessionId = options.sessionId;
    this.onError = options.onError;
  }

  /**
   * 解析单行 JSON，返回 ServerEvent 或 null（解析失败）
   */
  parse(line: string): ServerEvent | null {
    if (!line || line.trim() === '') {
      return null;
    }

    let raw: RawStreamEvent;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      // 非 JSON 行（可能是 debug 日志），忽略或回调
      if (this.onError) {
        this.onError(new Error(`JSON 解析失败: ${line}`), line);
      }
      return null;
    }

    return this.normalize(raw);
  }

  /** 返回队列中所有待处理的 tool_use 事件 */
  flushToolEvents(): ServerEvent[] {
    const events = this._pendingToolEvents.splice(0);
    return events;
  }

  /**
   * 标准化为 ServerEvent
   */
  private normalize(raw: RawStreamEvent): ServerEvent | null {
    this.seq++;

    // 根据 type 映射到不同的 StreamEvent
    switch (raw.type) {
      case 'assistant':
        return this.normalizeAssistant(raw);

      case 'tool_use':
        return this.normalizeToolUse(raw);

      case 'tool_result':
        return this.normalizeToolResult(raw);

      case 'result':
        return this.normalizeResult(raw);

      case 'permission_request':
        return this.normalizePermissionRequest(raw) ?? null;

      case 'system':
      case 'user':
        // --verbose 模式输出 system/user 事件（前端已本地处理），无需广播
        return null;

      default:
        // 未知类型，作为通用 token 事件
        return this.normalizeUnknown(raw);
    }
  }

  /**
   * 标准化 assistant 事件（AI 回复）
   * --verbose 模式：content 在 raw.message.content 内
   * 普通模式：content 直接在 raw.content
   */
  private normalizeAssistant(raw: RawStreamEvent): StreamEvent {
    let text: string | undefined;

    // --verbose 模式优先：content 嵌套在 message 对象内
    const contentBlocks = raw.message?.content || raw.content;

    if (typeof contentBlocks === 'string') {
      text = contentBlocks;
    } else if (Array.isArray(contentBlocks)) {
      // 提取 text 类型的 content block（跳过 thinking 块）
      text = contentBlocks
        .filter((block: any) => block.type === 'text' && block.text)
        .map((block: any) => block.text)
        .join('');

      // 提取 assistant 消息中嵌入的 tool_use 块
      const toolUses = (contentBlocks as any[] || [])
        .filter((b: any) => b.type === 'tool_use');
      for (const tu of toolUses) {
        const te = this.normalizeToolUse({
          type: 'tool_use',
          tool_name: tu.name,
          tool_use_id: tu.id,
          input: tu.input,
        });
        if (te) this._pendingToolEvents.push(te);
      }
    }

    return {
      type: 'stream',
      event: 'token',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        text,
        messageId: raw.message?.id || generateId('msg'),
        role: 'assistant',
      },
    };
  }

  /**
   * 标准化 tool_use 事件（工具调用）
   * 拦截 AskUserQuestion MCP 工具，转为 question_request
   */
  private normalizeToolUse(raw: RawStreamEvent): StreamEvent | QuestionRequest | null {
    return {
      type: 'stream',
      event: 'tool_use',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        toolName: raw.tool_name,
        input: raw.input,
        toolUseId: raw.tool_use_id,
      },
    };
  }

  /**
   * 标准化 tool_result 事件（工具结果）
   */
  private normalizeToolResult(raw: RawStreamEvent): StreamEvent {
    return {
      type: 'stream',
      event: 'tool_result',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        toolUseId: raw.tool_use_id,
        content: raw.output || raw.content as string,
        isError: raw.is_error,
      },
    };
  }

  /**
   * 标准化 result 事件（会话完成）
   */
  private normalizeResult(raw: RawStreamEvent): StreamEvent {
    return {
      type: 'stream',
      event: 'result',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        subtype: raw.subtype === 'error' ? 'error' : 'success',
        totalCostUsd: raw.cost_usd,
        durationMs: raw.duration_ms,
        usage: raw.usage,
      },
    };
  }

  /**
   * 标准化 permission_request 事件（Claude Code 请求用户审批权限）
   *
   * Claude Code stream-json 格式示例：
   * {"type":"permission_request","tool_use_id":"toolu_xxx","tool_name":"Bash",
   *  "options":["allow","deny"],"arguments":{"command":"npm install"},"prompt":"..."}
   */
  private normalizePermissionRequest(raw: RawStreamEvent): ApprovalRequest | null {
    // tool_use_id 是 Claude 权限响应匹配的必需字段，缺失时跳过
    if (!raw.tool_use_id) {
      return null;
    }

    // 从 arguments 中提取工具特定信息
    const command = raw.arguments?.command
      ? String(raw.arguments.command)
      : undefined;
    const filePath = raw.arguments?.file_path
      ? String(raw.arguments.file_path)
      : undefined;

    // 校验并过滤 options，仅保留合法值
    const validOptions = ['allow', 'deny', 'allow_always'] as const;
    const options: ('allow' | 'deny' | 'allow_always')[] = Array.isArray(raw.options)
      ? raw.options.filter((o): o is 'allow' | 'deny' | 'allow_always' =>
          validOptions.includes(o as typeof validOptions[number])
        )
      : [];
    if (options.length === 0) {
      options.push('allow', 'deny');
    }

    return {
      type: 'approval_request',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        requestId: generateId('approve'),
        toolUseId: raw.tool_use_id,
        toolName: raw.tool_name || 'unknown',
        command,
        filePath,
        reason: raw.prompt,
        options,
      },
    };
  }

  /**
   * 标准化未知类型事件
   */
  private normalizeUnknown(raw: RawStreamEvent): StreamEvent {
    return {
      type: 'stream',
      event: 'token',
      seq: this.seq,
      ts: Date.now(),
      sessionId: raw.session_id || this.sessionId,
      data: {
        text: `[未知事件类型: ${raw.type}]`,
        role: 'assistant',
      },
    };
  }

  /**
   * 重置序列号
   * @param from 可选的起始序列号（热重启恢复时传入，确保 seq 连续性）
   */
  reset(from: number = 0): void {
    this.seq = from;
  }

  /**
   * 获取当前序列号
   */
  getCurrentSeq(): number {
    return this.seq;
  }
}
