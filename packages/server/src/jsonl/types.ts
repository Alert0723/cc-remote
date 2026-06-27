/**
 * JSONL 文件格式类型定义
 * Claude Code 对话记录的 JSONL 结构
 */

/**
 * JSONL 内容块类型
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string };

/**
 * JSONL 基础字段
 */
interface JsonlBase {
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  version?: string;
  cwd?: string;
  gitBranch?: string;
}

/**
 * 用户消息
 */
export interface JsonlUserMessage extends JsonlBase {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
}

/**
 * AI 回复
 */
export interface JsonlAssistantMessage extends JsonlBase {
  type: 'assistant';
  message: {
    role: 'assistant';
    type?: 'message';
    content: ContentBlock[];
    model?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason?: string;
  };
}

/**
 * 系统消息
 */
export interface JsonlSystemMessage extends JsonlBase {
  type: 'system';
  subtype?: string;
  content?: string;
  level?: string;
}

/**
 * 其他类型的行（progress、mode、attachment 等）
 */
export interface JsonlOtherLine extends JsonlBase {
  type: string;
  [key: string]: unknown;
}

/**
 * JSONL 行的联合类型
 */
export type JsonlLine = JsonlUserMessage | JsonlAssistantMessage | JsonlSystemMessage | JsonlOtherLine;
