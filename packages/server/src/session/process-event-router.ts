/**
 * 进程事件路由器
 * 将 Claude Code 进程的 stdout/stderr/exit/error 事件转换为 ServerEvent 并广播
 * 从 SessionManager._handleProcessEvent 提取而来
 */

import type { ServerEvent, StreamEvent } from '@cc-remote/shared';
import { createServerEvent, generateId, detectAskUserQuestion } from '@cc-remote/shared';
import type { ClaudeProcessEvent } from '../claude/types.js';
import type { StreamParser } from '../claude/stream-parser.js';
import type { PendingManager } from './pending-manager.js';
import type { SessionInfo } from './manager.js';

/** ProcessEventRouter 所需的回调接口 */
export interface ProcessEventCallbacks {
  /** 广播事件到所有 WebSocket 客户端 */
  broadcastEvent: (event: ServerEvent) => void;
  /** 更新会话状态并广播 */
  updateStatus: (sessionId: string, status: string, detail?: string) => void;
  /** 广播会话列表更新 */
  broadcastSessionList: () => void;
  /** 缓存流式事件到 historyMessages */
  cacheStreamEvent: (sessionId: string, event: ServerEvent) => void;
  /** 获取会话对象（用于超时回调中的 process.sendPermissionResponse 和 exit 时的 watcher 检查） */
  getSession: (sessionId: string) => {
    process?: { isRunning(): boolean; sendPermissionResponse(toolUseId: string, decision: string): void } | null;
    watcher?: unknown;
  } | undefined;
}

export class ProcessEventRouter {
  constructor(
    private pendingManager: PendingManager,
    private callbacks: ProcessEventCallbacks,
  ) {}

  handle(sessionId: string, parser: StreamParser, event: ClaudeProcessEvent): void {
    if (event.type === 'stdout') {
      const serverEvent = parser.parse(event.data);
      if (serverEvent) {
        if (serverEvent.type === 'approval_request') {
          const approvalData = serverEvent.data;
          this.callbacks.updateStatus(sessionId, 'waiting_approval', `需审批: ${approvalData.toolName}`);
          this.callbacks.broadcastEvent(serverEvent);

          this.pendingManager.addApproval(sessionId, approvalData.requestId, {
            toolUseId: approvalData.toolUseId,
            toolName: approvalData.toolName,
            command: approvalData.command,
            timestamp: Date.now(),
          }, 60_000, (sid) => {
            const s = this.callbacks.getSession(sid);
            try {
              if (s?.process?.isRunning()) {
                s.process.sendPermissionResponse(approvalData.toolUseId, 'deny');
              }
            } catch { /* 忽略 stdin 写入失败 */ }
            this.callbacks.broadcastEvent(createServerEvent('error', {
              code: 'APPROVAL_TIMEOUT',
              message: `审批请求 ${approvalData.requestId} 已超时自动拒绝`,
            }, { sessionId: sid }));
            if (this.pendingManager.getApprovalCount(sid) === 0) {
              this.callbacks.updateStatus(sid, 'busy');
            }
          });
        } else if (serverEvent.type === 'question_request') {
          const questionData = serverEvent.data;
          this.callbacks.updateStatus(sessionId, 'waiting_question', `需回答: ${questionData.question.slice(0, 30)}`);
          this.callbacks.broadcastEvent(serverEvent);

          this.pendingManager.addQuestion(sessionId, questionData.requestId, {
            toolUseId: questionData.toolUseId,
            question: questionData.question,
            options: questionData.options,
            timestamp: Date.now(),
          }, 5 * 60_000, (sid) => {
            this.callbacks.broadcastEvent(createServerEvent('pending_resolved', {
              kind: 'question',
              requestId: questionData.requestId,
            }, { sessionId: sid }));
            if (this.pendingManager.getQuestionCount(sid) === 0) {
              this.callbacks.updateStatus(sid, 'busy');
            }
          });
        } else {
          this.callbacks.broadcastEvent(serverEvent);

          if (serverEvent.type === 'stream') {
            this.callbacks.cacheStreamEvent(sessionId, serverEvent);

            if (serverEvent.event === 'tool_use' && serverEvent.data.input) {
              const qData = detectAskUserQuestion(serverEvent.data.input);
              if (qData) {
                const qEvent = createServerEvent('question_request', {
                  requestId: generateId('q'),
                  toolUseId: serverEvent.data.toolUseId || '',
                  question: qData.question,
                  options: qData.options,
                }, { sessionId });
                this.callbacks.broadcastEvent(qEvent);
              }
            }
          }

          if (serverEvent.type === 'stream') {
            if (serverEvent.event === 'result') {
              this.callbacks.updateStatus(sessionId, 'idle', '刚刚');
            } else if (serverEvent.event === 'tool_use' && serverEvent.data.toolName) {
              this.callbacks.updateStatus(sessionId, 'busy', `正在调用 ${serverEvent.data.toolName}`);
            } else if (serverEvent.event === 'tool_result') {
              this.callbacks.updateStatus(sessionId, 'busy', '正在处理结果');
            } else {
              this.callbacks.updateStatus(sessionId, 'busy', '正在生成回复');
            }
          }
        }

        const toolEvents = parser.flushToolEvents();
        for (const te of toolEvents) {
          const streamEvent = te as StreamEvent;
          this.callbacks.broadcastEvent(streamEvent);
          this.callbacks.cacheStreamEvent(sessionId, streamEvent);
          if (streamEvent.event === 'tool_use' && streamEvent.data.input) {
            const qData = detectAskUserQuestion(streamEvent.data.input);
            if (qData) {
              const requestId = generateId('q');
              this.pendingManager.addQuestion(sessionId, requestId, {
                toolUseId: streamEvent.data.toolUseId || '',
                question: qData.question,
                options: qData.options,
                timestamp: Date.now(),
              }, 5 * 60_000, (sid) => {
                this.callbacks.broadcastEvent(createServerEvent('pending_resolved', {
                  kind: 'question',
                  requestId,
                }, { sessionId: sid }));
                if (this.pendingManager.getQuestionCount(sid) === 0) {
                  this.callbacks.updateStatus(sid, 'busy');
                }
              });
              this.callbacks.broadcastEvent(createServerEvent('question_request', {
                requestId,
                toolUseId: streamEvent.data.toolUseId || '',
                question: qData.question,
                options: qData.options,
              }, { sessionId }));
            }
          }
        }
      }
    } else if (event.type === 'stderr') {
      console.error(`[${sessionId}] stderr:`, event.data);
    } else if (event.type === 'exit') {
      const pendingIds = this.pendingManager.getApprovalRequestIds(sessionId);
      if (pendingIds.length > 0) {
        for (const requestId of pendingIds) {
          this.callbacks.broadcastEvent(createServerEvent('error', {
            code: 'APPROVAL_CANCELLED',
            message: `审批请求 ${requestId} 因进程退出已取消`,
          }, { sessionId }));
        }
      }
      this.pendingManager.clearAll(sessionId);

      // attach 模式触发 stooped 状态（由 SessionManager 通过 watcher 判断）
      // spawn 模式此处直接标记 stopped
      const s = this.callbacks.getSession(sessionId);
      if (!s || !('watcher' in s)) {
        this.callbacks.updateStatus(sessionId, 'stopped');
        this.callbacks.broadcastSessionList();
      }
    } else if (event.type === 'error') {
      console.error(`[${sessionId}] error:`, event.error);
      this.callbacks.broadcastEvent(createServerEvent('error', {
        code: 'PROCESS_ERROR',
        message: event.error?.message || 'Claude Code 进程异常',
        details: { sessionId },
      }, { sessionId }));
    }
  }
}
