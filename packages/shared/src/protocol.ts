/**
 * CC Remote 通信协议类型定义
 * PC 端和移动端共用的核心协议
 */

// ============ 共享类型 ============

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  name?: string;
  status: 'idle' | 'busy' | 'waiting_approval' | 'waiting_question' | 'stopped';
  statusDetail?: string;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  mode?: 'attach' | 'spawn';
  model?: string;
}

// ============ Server → Client 事件 ============

/**
 * 服务端发送给客户端的事件（discriminated union）
 */
export type ServerEvent =
  | StreamEvent
  | ApprovalRequest
  | QuestionRequest
  | StatusChange
  | SessionList
  | ErrorResponse
  | SyncResponse
  | ConnectedEvent
  | HistoryEvent
  | RestartNotice
  | SessionSwitched
  | PendingResolved;

/**
 * 基础事件字段
 */
interface BaseEvent {
  type: string;
  seq: number;
  ts: number;
  sessionId?: string;
}

/**
 * 流式输出事件（Claude Code 的实时输出）
 */
export interface StreamEvent extends BaseEvent {
  type: 'stream';
  event: 'token' | 'tool_use' | 'tool_result' | 'result';
  data: {
    text?: string;
    messageId?: string;
    role?: 'assistant' | 'user';
    toolName?: string;
    input?: Record<string, unknown>;
    toolUseId?: string;
    content?: string;
    isError?: boolean;
    subtype?: 'success' | 'error';
    totalCostUsd?: number;
    durationMs?: number;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

/**
 * 权限审批请求
 */
export interface ApprovalRequest extends BaseEvent {
  type: 'approval_request';
  data: {
    requestId: string;
    /** Claude Code 内部的 tool_use_id，用于 permission_response 匹配 */
    toolUseId: string;
    toolName: string;
    command?: string;
    filePath?: string;
    reason?: string;
    options: ('allow' | 'deny' | 'allow_always')[];
  };
}

/**
 * AI 提问请求（AskUserQuestion MCP 工具）
 * 用户从选项中选择一个答案回复给 AI
 */
export interface QuestionRequest extends BaseEvent {
  type: 'question_request';
  data: {
    requestId: string;
    /** Claude Code 内部的 tool_use_id，用于 tool_result 匹配 */
    toolUseId: string;
    question: string;
    options: Array<{
      label: string;
      value: string;
    }>;
  };
}

/**
 * 会话状态变更
 */
export interface StatusChange extends BaseEvent {
  type: 'status_change';
  data: {
    status: 'idle' | 'busy' | 'waiting_approval' | 'waiting_question' | 'stopped';
    detail?: string;
  };
}

/**
 * 会话列表更新
 */
export interface SessionList extends BaseEvent {
  type: 'session_list';
  data: {
    sessions: SessionInfo[];
  };
}

/**
 * 错误响应
 */
export interface ErrorResponse extends BaseEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * 断线恢复响应
 */
export interface SyncResponse extends BaseEvent {
  type: 'sync_response';
  data: {
    events: ServerEvent[];
    currentSeq: number;
    truncated: boolean;
  };
}

/**
 * 连接成功响应
 */
export interface ConnectedEvent extends BaseEvent {
  type: 'connected';
  data: {
    sessionId?: string;
    status: string;
    serverVersion: string;
  };
}

/**
 * 工具调用详情（递归结构，支持 Skill 嵌套子工具）
 */
export interface ToolCallDetail {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** 工具类型：'skill' 表示 Skill 调用，'tool' 表示普通工具 */
  type?: 'skill' | 'tool';
  /** 执行耗时（ms），从 tool_use 到 tool_result 的时间差 */
  durationMs?: number;
  /** tool_use 事件的时间戳（ms），用于计算 durationMs */
  startTime?: number;
  /** 执行状态 */
  status?: 'pending' | 'success' | 'error';
  /** Skill 内部调用的子工具列表 */
  children?: ToolCallDetail[];
}

/**
 * 历史消息（从 JSONL 解析）
 */
export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: ToolCallDetail[];
  toolResults?: Array<{
    toolUseId: string;
    content: string;
    isError?: boolean;
  }>;
}

/**
 * 历史事件（attach 模式：发送完整对话历史）
 */
export interface HistoryEvent extends BaseEvent {
  type: 'history';
  data: {
    messages: HistoryMessage[];
    sessionId: string;
    mode: 'attach' | 'spawn';
  };
}

/**
 * 服务端重启通知（热重启前广播给所有客户端）
 */
export interface RestartNotice extends BaseEvent {
  type: 'restart_notice';
  data: {
    message: string;
    savedSessions: number;
  };
}

/**
 * 会话切换确认（服务端确认客户端切换到目标会话）
 */
export interface SessionSwitched extends BaseEvent {
  type: 'session_switched';
  data: {
    sessionId: string;
    session: SessionInfo;
  };
}

/**
 * 待处理项已解决通知（多设备同步）
 * 当某个客户端回复了提问或审批后，广播此事件通知其他客户端清除对应弹窗
 */
export interface PendingResolved extends BaseEvent {
  type: 'pending_resolved';
  data: {
    /** 待处理项类型 */
    kind: 'approval' | 'question';
    /** 已解决的请求 ID */
    requestId: string;
  };
}

// ============ Client → Server 指令 ============

/**
 * 客户端发送给服务端的指令（discriminated union）
 */
export type ClientCommand =
  | SendMessageCommand
  | InterruptCommand
  | ApproveCommand
  | AnswerCommand
  | SyncFromCommand
  | CreateSessionCommand
  | SwitchSessionCommand
  | AuthCommand;

interface BaseCommand {
  type: 'command';
  action: string;
  sessionId?: string;
}

/**
 * 发送用户消息
 */
export interface SendMessageCommand extends BaseCommand {
  action: 'send_message';
  data: {
    text: string;
  };
}

/**
 * 中断当前生成
 */
export interface InterruptCommand extends BaseCommand {
  action: 'interrupt';
}

/**
 * 审批权限请求
 */
export interface ApproveCommand extends BaseCommand {
  action: 'approve';
  data: {
    requestId: string;
    decision: 'allow' | 'deny' | 'allow_always';
  };
}

/**
 * 回复 AI 提问
 */
export interface AnswerCommand extends BaseCommand {
  action: 'answer';
  data: {
    requestId: string;
    /** 用户选择的选项值 */
    answer: string;
  };
}

/**
 * 断线恢复请求
 */
export interface SyncFromCommand extends BaseCommand {
  action: 'sync_from';
  data: {
    lastSeq: number;
  };
}

/**
 * 创建新会话
 */
export interface CreateSessionCommand extends BaseCommand {
  action: 'create_session';
  data: {
    projectPath?: string;
    model?: string;
    resume?: boolean;
  };
}

/**
 * 切换到其他会话
 */
export interface SwitchSessionCommand extends BaseCommand {
  action: 'switch_session';
  data: {
    targetSessionId: string;
  };
}

/**
 * WebSocket 首条消息认证（替代 URL query param 传 Token）
 */
export interface AuthCommand extends BaseCommand {
  action: 'auth';
  data: {
    token: string;
  };
}

// ============ 常量 ============

export const PROTOCOL_VERSION = '1.0.0';
export const DEFAULT_HTTP_PORT = 8420;
export const DEFAULT_WS_PORT = 8421;
export const DEFAULT_BUFFER_SIZE = 5000;

export const RECONNECT_CONFIG = {
  maxRetries: 10,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
} as const;

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

// ============ AskUserQuestion 检测 ============

/**
 * 从工具调用 input 中提取的提问数据
 */
export interface QuestionData {
  question: string;
  options: Array<{ label: string; value: string }>;
}

/**
 * 从工具调用 input 中检测 AskUserQuestion 提问数据
 * 用于统一服务端和客户端的多处重复检测逻辑
 * @returns 提取的提问数据，非 AskUserQuestion 时返回 null
 */
export function detectAskUserQuestion(input: Record<string, unknown>): QuestionData | null {
  const questions = input.questions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  const q = questions[0];
  const rawOptions = (q.options as Array<Record<string, string>>) || [];
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return null;

  return {
    question: String(q.question || q.header || ''),
    options: rawOptions.map((opt, i) => ({
      label: typeof opt.label === 'string' ? opt.label : `选项 ${i + 1}`,
      value: typeof opt.label === 'string' ? opt.label : String(i),
    })),
  };
}

/**
 * 创建服务端事件（辅助函数）
 * 注意：调用方需确保 type 与 data 的一致性
 */
export function createServerEvent(
  type: ServerEvent['type'],
  data: ServerEvent['data'],
  options: { sessionId?: string; seq?: number; event?: StreamEvent['event'] } = {}
): ServerEvent {
  const { sessionId, seq = 0, event } = options;
  return {
    type,
    event,
    data,
    sessionId,
    seq,
    ts: Date.now(),
  } as ServerEvent;
}

/**
 * 合法的服务端事件类型
 */
const VALID_SERVER_EVENT_TYPES = [
  'stream',
  'approval_request',
  'question_request',
  'status_change',
  'session_list',
  'error',
  'sync_response',
  'connected',
  'history',
  'restart_notice',
  'session_switched',
  'pending_resolved',
] as const;

/**
 * 验证服务端事件格式
 */
export function isValidServerEvent(obj: unknown): obj is ServerEvent {
  if (obj === null || obj === undefined) return false;
  if (typeof obj !== 'object') return false;

  const event = obj as Record<string, unknown>;
  return (
    typeof event.type === 'string' &&
    VALID_SERVER_EVENT_TYPES.includes(event.type as typeof VALID_SERVER_EVENT_TYPES[number]) &&
    typeof event.seq === 'number' &&
    typeof event.ts === 'number'
  );
}

/**
 * 合法的客户端指令动作
 */
const VALID_CLIENT_ACTIONS = [
  'send_message',
  'interrupt',
  'approve',
  'answer',
  'sync_from',
  'create_session',
  'switch_session',
  'auth',
] as const;

/**
 * 验证客户端指令格式
 */
export function isValidClientCommand(obj: unknown): obj is ClientCommand {
  if (obj === null || obj === undefined) return false;
  if (typeof obj !== 'object') return false;

  const cmd = obj as Record<string, unknown>;
  return (
    cmd.type === 'command' &&
    typeof cmd.action === 'string' &&
    VALID_CLIENT_ACTIONS.includes(cmd.action as typeof VALID_CLIENT_ACTIONS[number])
  );
}
