/**
 * 会话状态管理（Zustand）
 */

import { create } from 'zustand';
import type { ServerEvent, SessionInfo, ToolCallDetail } from '@cc-remote/shared';
import { detectAskUserQuestion } from '@cc-remote/shared';
import { useConnectionStore } from './connectionStore.js';
import { showToast } from '../lib/toast.js';
import { addRecentPath } from '../lib/recentPaths.js';
import { eventBridge } from '../lib/event-bridge.js';

/** 每会话最大消息数，超出后裁剪旧消息（保留首条） */
const MAX_MESSAGES_PER_SESSION = 500;

/** 裁剪消息列表到上限，始终保留第一条消息 */
function trimMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES_PER_SESSION) return messages;
  const keep = MAX_MESSAGES_PER_SESSION - 1;
  return [messages[0], ...messages.slice(-keep)];
}

/** 将工具调用列表按 Skill 嵌套关系构建层级 */
function buildToolCallHierarchy(tools: ToolCallDetail[]): ToolCallDetail[] {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const result: ToolCallDetail[] = [];
  let activeSkill: ToolCallDetail | null = null;

  for (const tc of tools) {
    const isSkill = tc.name === 'Skill';
    if (isSkill) {
      tc.type = 'skill';
      tc.children = [];
      result.push(tc);
      activeSkill = tc;
    } else if (activeSkill && activeSkill.status === undefined) {
      // 子工具归属到活跃的 Skill 下
      tc.type = 'tool';
      activeSkill.children!.push(tc);
    } else {
      tc.type = 'tool';
      result.push(tc);
      activeSkill = null;
    }
    // 当 Skill 收到结果时标记状态
    if (tc === activeSkill && tc.result !== undefined) {
      tc.status = tc.isError ? 'error' : 'success';
      activeSkill = null;
    }
  }

  return result;
}

/**
 * 消息类型
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
  /** 工具调用列表（历史消息附带，支持 Skill 嵌套子工具） */
  toolCalls?: ToolCallDetail[];
}

interface SessionState {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  messages: Map<string, Message[]>;
  /** 当前待审批的权限请求 */
  pendingApproval: {
    requestId: string;
    sessionId: string;
    toolName: string;
    command?: string;
    options: ('allow' | 'deny' | 'allow_always')[];
  } | null;
  /** 当前待回答的 AI 提问 */
  pendingQuestion: {
    requestId: string;
    sessionId: string;
    question: string;
    options: Array<{ label: string; value: string }>;
  } | null;

  // Actions
  handleEvent: (event: ServerEvent) => void;
  setCurrentSession: (sessionId: string | null) => void;
  addMessage: (sessionId: string, message: Message) => void;
  sendMessage: (text: string) => Promise<void>;
  interrupt: () => void;
  createSession: (options?: { projectPath?: string; model?: string; resume?: boolean }) => Promise<void>;
  /** 审批当前权限请求 */
  approve: (decision: 'allow' | 'deny' | 'allow_always') => Promise<void>;
  /** 回复 AI 提问 */
  answer: (answerValue: string) => Promise<void>;
  /** 从磁盘 attach 一个已有会话 */
  attachDiskSession: (sessionId: string, projectPath?: string) => Promise<void>;
  /** 获取磁盘可用会话列表 */
  fetchAvailableSessions: () => Promise<{ sessionId: string; projectPath: string; attached: boolean }[]>;
  /** 断开 attach 模式会话（状态变为 stopped） */
  detachSession: (sessionId: string) => Promise<void>;
  /** 关闭并删除会话 */
  closeSession: (sessionId: string) => Promise<void>;
  /** 从磁盘删除未连接的会话 */
  deleteDiskSession: (sessionId: string, projectPath?: string) => Promise<void>;
  /** 重新激活已停止的 spawn 会话（全控制模式） */
  reconnectSession: (sessionId: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => {
  // 通过 EventBridge 接收 WSClient 的 ServerEvent（替代 window.__sessionStore）
  eventBridge.on((event) => get().handleEvent(event));

  return {
    sessions: [],
    currentSessionId: null,
    messages: new Map(),
    pendingApproval: null,
    pendingQuestion: null,

    handleEvent: (event) => {
      if (event.type === 'session_list') {
        const { currentSessionId } = get();
        const newSessions: SessionInfo[] = Array.isArray(event.data?.sessions)
          ? event.data.sessions
          : [];
        // 当前会话在列表中且已停止 → 清除选中，避免界面显示已停止的会话
        const cur = newSessions.find(s => s.id === currentSessionId);
        const becameStopped = cur?.status === 'stopped';
        set({
          sessions: newSessions,
          ...(becameStopped ? { currentSessionId: null, pendingQuestion: null, pendingApproval: null } : {}),
        });
        // 记录所有已连接会话的项目路径到历史
        for (const s of newSessions) {
          if (s.projectPath) addRecentPath(s.projectPath);
        }
      } else if (event.type === 'status_change') {
        const { sessions, currentSessionId } = get();
        const updated = sessions.map((s) =>
          s.id === event.sessionId ? { ...s, status: event.data.status } : s
        );
        // 当前会话变为已停止 → 清除选中 + 清除弹窗
        const becameStopped = event.sessionId === currentSessionId && event.data.status === 'stopped';
        set({
          sessions: updated,
          ...(becameStopped ? { currentSessionId: null, pendingQuestion: null, pendingApproval: null } : {}),
        });
      } else if (event.type === 'stream') {
        const sessionId = event.sessionId;
        if (!sessionId) return;

        const { messages } = get();
        const sessionMessages = messages.get(sessionId) || [];

        if (event.event === 'token' && event.data.text) {
          const role = event.data.role || 'assistant';
          const msgId = event.data.messageId || `msg-${Date.now()}`;
          const lastMsg = sessionMessages[sessionMessages.length - 1];

          // 流式续写：同一条消息的后续 token
          if (lastMsg?.role === role && lastMsg.id === msgId) {
            lastMsg.content += event.data.text;
          } else if (role === 'user' && lastMsg?.role === 'user' && lastMsg.content === event.data.text) {
            // 用户消息去重：本地 sendMessage 已添加过了，跳过服务端回传的副本
          } else {
            sessionMessages.push({
              id: msgId,
              role,
              content: event.data.text,
              timestamp: event.ts,
            });
          }
        } else if (event.event === 'tool_use') {
          // 包含 questions 数组的工具调用 → 转为提问弹窗（不依赖 toolName 匹配）
          const qData = detectAskUserQuestion(event.data.input || {});
          if (qData) {
            set({
              pendingQuestion: {
                requestId: `q-${Date.now()}`,
                sessionId: event.sessionId || get().currentSessionId || '',
                question: qData.question,
                options: qData.options,
              },
            });
            return;
          }

          const isSkill = event.data.toolName === 'Skill';
          const tc: ToolCallDetail = {
            id: event.data.toolUseId || `tool-${Date.now()}`,
            name: event.data.toolName || 'Unknown',
            input: event.data.input || {},
            type: isSkill ? 'skill' : 'tool',
            status: 'pending',
            children: isSkill ? [] : undefined,
          };
          // 如果有活跃的 Skill 且本条不是 Skill 本身，挂到其 children 下
          const lastToolMsg = [...sessionMessages].reverse().find(m => m.toolCalls?.some(c => c.type === 'skill' && c.status === 'pending'));
          if (lastToolMsg && !isSkill) {
            const skillCall = lastToolMsg.toolCalls!.find(c => c.type === 'skill' && c.status === 'pending');
            if (skillCall) {
              skillCall.children = skillCall.children || [];
              skillCall.children.push(tc);
              // 不创建独立消息，直接返回
              return;
            }
          }
          sessionMessages.push({
            id: event.data.toolUseId || `tool-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: event.ts,
            toolName: event.data.toolName,
            toolInput: event.data.input,
            toolCalls: isSkill ? [tc] : undefined,
          });
          // 记录开始时间用于计算耗时
          tc.startTime = event.ts;
        } else if (event.event === 'tool_result') {
          let matched = false;
          // 先查独立消息
          for (let i = sessionMessages.length - 1; i >= 0; i--) {
            if (sessionMessages[i].id === event.data.toolUseId) {
              sessionMessages[i].toolResult = event.data.content;
              sessionMessages[i].isError = event.data.isError;
              if (sessionMessages[i].toolCalls?.[0]) {
                const c = sessionMessages[i].toolCalls![0];
                c.result = event.data.content;
                c.isError = event.data.isError;
                c.status = event.data.isError ? 'error' : 'success';
                if (c.startTime) {
                  c.durationMs = event.ts - c.startTime;
                }
              }
              matched = true;
              break;
            }
          }
          if (!matched) {
            // 查 Skill children
            for (let i = sessionMessages.length - 1; i >= 0; i--) {
              const tcArr = sessionMessages[i].toolCalls;
              if (tcArr) {
                for (const c of tcArr) {
                  if (c.children) {
                    for (const child of c.children) {
                      if (child.id === event.data.toolUseId) {
                        child.result = event.data.content;
                        child.isError = event.data.isError;
                        child.status = event.data.isError ? 'error' : 'success';
                        if (child.startTime) {
                          child.durationMs = event.ts - child.startTime;
                        }
                        // 检查 Skill 是否所有子工具都已完成
                        if (c.children.every(ch => ch.status === 'success' || ch.status === 'error')) {
                          // 等 Skill 自身 result 到达后更新 skill status
                        }
                        matched = true;
                        break;
                      }
                    }
                  }
                }
                if (matched) break;
              }
            }
          }
          // 若仍未匹配，搜索 history 消息的 toolCalls 数组
          if (!matched) {
            for (let i = sessionMessages.length - 1; i >= 0; i--) {
              const msg = sessionMessages[i];
              if (msg.toolCalls) {
                for (const tc of msg.toolCalls) {
                  if (tc.id === event.data.toolUseId) {
                    tc.result = event.data.content;
                    tc.isError = event.data.isError;
                    matched = true;
                    break;
                  }
                }
                if (matched) break;
              }
            }
          }
        } else if (event.event === 'result') {
          // 本轮对话完成，记录结果
          if (event.data.subtype === 'error') {
            sessionMessages.push({
              id: `result-${event.ts}`,
              role: 'assistant',
              content: `❌ 执行出错`,
              timestamp: event.ts,
            });
          }
        }

        messages.set(sessionId, [...trimMessages(sessionMessages)]);
        set({ messages: new Map(messages) });
      } else if (event.type === 'approval_request') {
        // 权限审批请求：弹出对话框
        if (event.data && event.sessionId) {
          set({
            pendingApproval: {
              requestId: event.data.requestId,
              sessionId: event.sessionId,
              toolName: event.data.toolName,
              command: event.data.command,
              options: event.data.options,
            },
          });
        }
      } else if (event.type === 'question_request') {
        showToast('收到提问事件', 'success', 1000);
        if (event.data && event.sessionId) {
          set({
            pendingQuestion: {
              requestId: event.data.requestId,
              sessionId: event.sessionId,
              question: event.data.question,
              options: event.data.options,
            },
          });
        }
      } else if (event.type === 'error') {
        // 审批相关的错误事件（超时/取消/过期）→ 清除弹窗
        const approvalCodes = ['APPROVAL_TIMEOUT', 'APPROVAL_CANCELLED', 'APPROVAL_EXPIRED'];
        if (approvalCodes.includes(event.data.code)) {
          set({ pendingApproval: null });
        }
        // 提问相关错误 → 清除问题弹窗
        if (event.data.code === 'QUESTION_EXPIRED') {
          set({ pendingQuestion: null });
        }
      } else if (event.type === 'history') {
        // 防御：data 或 messages 为空时跳过
        if (!event.data || !Array.isArray(event.data.messages)) return;
        // 合并模式：用 JSONL 中的真实 UUID 替换本地临时 ID 消息
        const sessionId = event.data.sessionId;
        const incoming: Message[] = event.data.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).getTime(),
          toolCalls: m.toolCalls ? buildToolCallHierarchy(m.toolCalls) : undefined,
        }));

        // 为历史消息计算工具耗时：匹配相邻 assistant(user) 消息的时间差
        for (let i = 0; i < incoming.length - 1; i++) {
          const cur = incoming[i];
          if (cur.role !== 'assistant' || !cur.toolCalls) continue;
          const next = incoming[i + 1];
          if (next.role !== 'user') continue;
          const estimatedMs = next.timestamp - cur.timestamp;
          if (estimatedMs <= 0 || estimatedMs > 600_000) continue; // 忽略无效值或超 10 分钟
          for (const tc of cur.toolCalls) {
            if (!tc.durationMs && !tc.startTime) {
              tc.durationMs = estimatedMs;
            }
          }
        }

        const { messages: allMessages, currentSessionId } = get();
        const existing = allMessages.get(sessionId) || [];
        const existingIds = new Set(existing.map(m => m.id));

        // 构建「内容 → 索引」映射：只匹配非 UUID 格式的本地用户消息
        // （本地消息 ID 为 `user-${Date.now()}`，JSONL 中为真实 UUID）
        const contentIndex = new Map<string, number>();
        for (let i = 0; i < existing.length; i++) {
          const m = existing[i];
          if (m.role === 'user' && m.content && m.id.startsWith('user-')) {
            contentIndex.set(m.content, i);
          }
        }

        const merged = [...existing];
        for (const msg of incoming) {
          if (existingIds.has(msg.id)) {
            // 已存在：用 JSONL 权威数据更新字段（修复旧损坏的 toolCalls 无 result 问题）
            const idx = merged.findIndex(m => m.id === msg.id);
            if (idx !== -1) merged[idx] = { ...merged[idx], ...msg };
            continue;
          }

          // 寻找内容匹配的本地临时 ID 消息，替换为真实 UUID
          if (msg.role === 'user' && msg.content) {
            const matchIdx = contentIndex.get(msg.content);
            if (matchIdx !== undefined) {
              merged[matchIdx] = msg; // 用 UUID 消息替换本地临时 ID 消息
              continue;
            }
          }

          merged.push(msg);
        }
        allMessages.set(sessionId, [...trimMessages(merged)]);
        set({
          messages: new Map(allMessages),
          currentSessionId: currentSessionId || sessionId,
        });
      } else if (event.type === 'session_switched') {
        // 服务端确认会话切换：更新该会话的 info
        const sessionId = event.data.sessionId;
        const { sessions } = get();
        const updated = sessions.map((s) =>
          s.id === sessionId ? event.data.session : s
        );
        set({ sessions: updated });
        // 记录切换到的会话项目路径到历史
        if (event.data.session?.projectPath) {
          addRecentPath(event.data.session.projectPath);
        }
      } else if (event.type === 'pending_resolved') {
        // 其他设备已处理待审批/提问，清除当前设备的弹窗
        if (!event.data) return;
        const { kind, requestId } = event.data;
        const { pendingQuestion, pendingApproval } = get();
        if (kind === 'question' && pendingQuestion?.requestId === requestId) {
          set({ pendingQuestion: null });
        } else if (kind === 'approval' && pendingApproval?.requestId === requestId) {
          set({ pendingApproval: null });
        }
      } else if (event.type === 'restart_notice') {
        // 服务端即将重启：连接状态由 connectionStore 自动管理
        // 无需额外操作，WS 断开后会自动重连
      }
    },

    setCurrentSession: (sessionId) => {
      set({ currentSessionId: sessionId });
    },

    addMessage: (sessionId, message) => {
      const { messages } = get();
      const sessionMessages = messages.get(sessionId) || [];
      sessionMessages.push(message);
      messages.set(sessionId, [...trimMessages(sessionMessages)]);
      set({ messages: new Map(messages) });
    },

    sendMessage: async (text) => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      const { wsClient, apiClient } = useConnectionStore.getState();

      // 添加用户消息到本地
      get().addMessage(currentSessionId, {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      });

      // 优先通过 WebSocket 发送，断开时降级到 HTTP
      if (wsClient?.isConnected()) {
        wsClient.sendMessage(currentSessionId, text);
      } else if (apiClient) {
        await apiClient.sendMessage(currentSessionId, text);
      }
    },

    interrupt: () => {
      const { currentSessionId } = get();
      if (!currentSessionId) return;

      const { wsClient, apiClient } = useConnectionStore.getState();

      if (wsClient?.isConnected()) {
        wsClient.interrupt(currentSessionId);
      } else if (apiClient) {
        apiClient.interrupt(currentSessionId);
      }
    },

    createSession: async (options) => {
      const { wsClient, apiClient } = useConnectionStore.getState();

      // 记录到历史项目
      if (options?.projectPath) {
        addRecentPath(options.projectPath);
      }

      // 优先 WebSocket 发送，断开时降级到 HTTP API
      if (wsClient?.isConnected()) {
        wsClient.createSession(options);
        // WebSocket 路径：fire-and-forget，会话将在 session_list 事件中自动出现
        return;
      }

      if (!apiClient) {
        throw new Error('API 客户端未初始化');
      }

      const session = await apiClient.createSession(options);
      // HTTP 回退：将新会话合并到 store 并自动选中
      set((state) => ({
        sessions: [...state.sessions, session],
        currentSessionId: session.id,
      }));
    },

    approve: async (decision) => {
      const { pendingApproval } = get();
      if (!pendingApproval) return;

      const sessionId = pendingApproval.sessionId;
      const requestId = pendingApproval.requestId;

      // 乐观清除弹窗（防止重复点击）
      set({ pendingApproval: null });

      const { wsClient, apiClient } = useConnectionStore.getState();

      if (wsClient?.isConnected()) {
        wsClient.approve(sessionId, requestId, decision);
      } else if (apiClient) {
        try {
          await apiClient.approve(sessionId, requestId, decision);
        } catch (err) {
          console.error('审批请求发送失败:', err);
        }
      }
    },

    answer: async (answerValue) => {
      const { pendingQuestion, sessions } = get();
      if (!pendingQuestion) return;
      const sessionId = pendingQuestion.sessionId;
      const requestId = pendingQuestion.requestId;

      // 校验会话是否存在且未停止
      const session = sessions.find(s => s.id === sessionId);
      if (!session || session.status === 'stopped') {
        set({ pendingQuestion: null });
        showToast('会话已断开，请重新连接后再回答', 'error', 3000);
        return;
      }

      set({ pendingQuestion: null });
      const { wsClient } = useConnectionStore.getState();
      if (wsClient?.isConnected()) {
        wsClient.sendCommand({
          type: 'command',
          action: 'answer',
          sessionId,
          data: { requestId, answer: answerValue },
        });
      }
    },

    attachDiskSession: async (sessionId, projectPath) => {
      const { apiClient } = useConnectionStore.getState();
      if (!apiClient) {
        throw new Error('API 客户端未初始化');
      }

      const session = await apiClient.attachSession(sessionId, projectPath);
      // 记录项目路径到历史
      if (projectPath) addRecentPath(projectPath);
      // 合并到 store 并自动选中
      set((state) => ({
        sessions: [...state.sessions.filter((s) => s.id !== session.id), session],
        currentSessionId: session.id,
        pendingQuestion: null,
      }));
    },

    fetchAvailableSessions: async () => {
      const { apiClient } = useConnectionStore.getState();
      if (!apiClient) return [];
      try {
        const data = await apiClient.getAvailableSessions();
        return data.sessions;
      } catch {
        console.warn('[SessionStore] 获取可用会话列表失败');
        return [];
      }
    },

    /** 断开会话：从内存移除，放回磁盘列表 */
    detachSession: async (sessionId) => {
      const { apiClient } = useConnectionStore.getState();
      if (!apiClient) {
        throw new Error('API 客户端未初始化');
      }

      await apiClient.detachSession(sessionId);
      // 从本地状态移除（服务端广播 session_list 也会同步）
      const { sessions, messages, currentSessionId } = get();
      const updated = sessions.filter((s) => s.id !== sessionId);
      const newMessages = new Map(messages);
      newMessages.delete(sessionId);
      set({ sessions: updated, messages: newMessages });
      // 如果断开的是当前会话，切换到第一个可用
      if (currentSessionId === sessionId) {
        const next = updated.length > 0 ? updated[0].id : null;
        set({ currentSessionId: next });
      }
    },

    /** 关闭并删除会话 */
    closeSession: async (sessionId) => {
      const { apiClient } = useConnectionStore.getState();
      if (apiClient) {
        try {
          await apiClient.closeSession(sessionId);
        } catch {
          // 服务端可能已关闭，忽略错误
        }
      }
      // 从本地 store 中移除
      const { sessions, messages, currentSessionId } = get();
      const updated = sessions.filter((s) => s.id !== sessionId);
      const newMessages = new Map(messages);
      newMessages.delete(sessionId);
      set({ sessions: updated, messages: newMessages });
      // 如果关闭的是当前会话，切换到第一个可用
      if (currentSessionId === sessionId) {
        const next = updated.length > 0 ? updated[0].id : null;
        set({ currentSessionId: next });
      }
    },

    /** 从磁盘删除未连接的会话 */
    deleteDiskSession: async (sessionId, projectPath) => {
      const { apiClient } = useConnectionStore.getState();
      if (!apiClient) {
        throw new Error('API 客户端未初始化');
      }
      await apiClient.deleteDiskSession(sessionId, projectPath);
    },

    /** 重新激活已停止的 spawn 会话（全控制模式），SessionDrawer 和 ChatView 共用 */
    reconnectSession: async (sessionId) => {
      const { apiClient } = useConnectionStore.getState();
      if (!apiClient) throw new Error('API 客户端未初始化');

      const { sessions } = get();
      const session = sessions.find(s => s.id === sessionId);
      if (!session || session.status !== 'stopped') {
        throw new Error('会话未处于停止状态，无需重连');
      }

      const newInfo = await apiClient.takeoverSession(sessionId);
      // 记录项目路径到历史
      if (newInfo.projectPath) addRecentPath(newInfo.projectPath);
      set(state => ({
        sessions: state.sessions.filter(x => x.id !== sessionId).concat(newInfo),
        currentSessionId: newInfo.id,
        pendingQuestion: null,
      }));
    },
  };
});
