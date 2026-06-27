/**
 * 会话管理器
 * 管理 Claude Code 会话生命周期，整合 Spawner、Parser、WebSocket
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type { ServerEvent, ClientCommand, SendMessageCommand, ApproveCommand, AnswerCommand } from '@cc-remote/shared';
import { createServerEvent, generateId, detectAskUserQuestion } from '@cc-remote/shared';
import { claudeSpawner } from '../claude/spawner.js';
import type { ClaudeProcess, ClaudeProcessEvent } from '../claude/types.js';
import { StreamParser } from '../claude/stream-parser.js';
import type { CCWebSocketServer } from '../ws/server.js';
import type { WebSocket } from 'ws';
import { JsonlHistory } from '../jsonl/history.js';
import { JsonlWatcher } from '../jsonl/watcher.js';
import type { HistoryMessage } from '@cc-remote/shared';
import { saveStateFile, loadStateFile } from '../state/persist.js';
import type { PersistedSession } from '../state/persist.js';
import { PendingManager } from './pending-manager.js';
import { ProcessEventRouter } from './process-event-router.js';
import type { ProcessEventCallbacks } from './process-event-router.js';

/** historyMessages 最大条数，超出后裁剪旧消息 */
const MAX_HISTORY_MESSAGES = 500;

/**
 * 会话状态
 */
export type SessionStatus = 'idle' | 'busy' | 'waiting_approval' | 'stopped';

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  name?: string;
  status: SessionStatus;
  statusDetail?: string;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
  mode?: 'attach' | 'spawn';
  model?: string;
}

/**
 * 会话实例（内部使用）
 */
interface Session {
  info: SessionInfo;
  process: ClaudeProcess | null;
  parser: StreamParser;
  watcher?: JsonlWatcher;
  /** JSONL 文件路径（创建 watcher 时记录，用于状态持久化） */
  _jsonlPath?: string;
  /** attach 模式：存储完整历史消息，用于新客户端连接时重放 */
  historyMessages?: HistoryMessage[];
  /** spawn 模式：当前轮次未完成的流式消息，result 事件时合并到 historyMessages */
  _currentTurnMessages?: HistoryMessage[];
  /** 恢复时间戳，watcher 在此之后 5 秒内不会更新状态 */
  _restoreTime?: number;
  /** attach 模式：进程退出清理锁，防止并发 send_message 触发重复广播 */
  _cleaningUp?: boolean;
}

/**
 * 会话管理器
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private wsServer?: CCWebSocketServer;
  private _heartbeatTimer?: ReturnType<typeof setInterval>;
  private pendingManager = new PendingManager();
  private processEventRouter: ProcessEventRouter;

  constructor() {
    super();

    const callbacks: ProcessEventCallbacks = {
      broadcastEvent: (e) => this._broadcastEvent(e),
      updateStatus: (sid, status, detail) => this._updateStatus(sid, status as SessionStatus, detail),
      broadcastSessionList: () => this._broadcastSessionList(),
      cacheStreamEvent: (sid, e) => this._cacheStreamEvent(sid, e),
      getSession: (sid) => this.sessions.get(sid),
    };
    this.processEventRouter = new ProcessEventRouter(this.pendingManager, callbacks);
  }

  /**
   * 设置 WebSocket 服务（用于广播事件）
   */
  setWebSocketServer(wsServer: CCWebSocketServer): void {
    this.wsServer = wsServer;
  }

  /**
   * 新客户端连接时推送当前状态（会话列表 + 所有已 attach 的历史消息）
   */
  sendStateToNewClient(ws: WebSocket): void {
    if (!this.wsServer) return;

    // 1. 发送会话列表
    const sessions = Array.from(this.sessions.values()).map(s => s.info);
    this.wsServer.sendToClient(
      ws,
      createServerEvent('session_list', { sessions })
    );

    // 2. 对每个已 attach 且有历史的会话，重放历史事件
    for (const [sessionId, session] of this.sessions) {
      if (session.historyMessages && session.historyMessages.length > 0) {
        this.wsServer.sendToClient(
          ws,
          createServerEvent('history', {
            messages: session.historyMessages,
            sessionId,
            mode: 'attach',
          }, { sessionId })
        );
      }
    }

    // 3. 重放当前待处理的提问和审批（多设备状态同步）
    for (const [sessionId] of this.sessions) {
      // 待回答的提问
      const anyQuestion = this.pendingManager.getAnyQuestion(sessionId);
      if (anyQuestion) {
        this.wsServer.sendToClient(
          ws,
          createServerEvent('question_request', {
            requestId: anyQuestion.toolUseId,
            toolUseId: anyQuestion.toolUseId,
            question: anyQuestion.question,
            options: anyQuestion.options,
          }, { sessionId })
        );
      }

      // 待审批的请求
      const anyApproval = this.pendingManager.getAnyApproval(sessionId);
      if (anyApproval) {
        this.wsServer.sendToClient(
          ws,
          createServerEvent('approval_request', {
            requestId: anyApproval.toolUseId,
            toolUseId: anyApproval.toolUseId,
            toolName: anyApproval.toolName,
            command: anyApproval.command,
            options: ['allow', 'deny', 'allow_always'],
          }, { sessionId })
        );
      }
    }
  }

  /**
   * 创建新会话
   */
  async createSession(options: {
    projectPath?: string;
    model?: string;
    resume?: boolean;
  } = {}): Promise<SessionInfo> {
    const sessionId = uuidv4();
    const now = Date.now();

    const info: SessionInfo = {
      id: sessionId,
      status: 'idle',
      mode: 'spawn',
      createdAt: now,
      updatedAt: now,
      projectPath: options.projectPath,
      model: options.model,
    };

    const parser = new StreamParser({ sessionId });

    const session: Session = {
      info,
      process: null,
      parser,
    };

    this.sessions.set(sessionId, session);

    // 启动 Claude Code 进程
    try {
      const proc = claudeSpawner.spawn({
        sessionId,
        projectPath: options.projectPath,
        model: options.model,
        resume: options.resume,
      });

      session.process = proc;

      // 监听进程事件
      proc.on('event', (event) => {
        this._handleProcessEvent(sessionId, event);
      });
    } catch (err) {
      // 启动失败，清理已创建的会话记录
      this.sessions.delete(sessionId);
      throw err;
    }

    this._broadcastSessionList();
    return info;
  }

  /**
   * 从磁盘以全控制（spawn）模式连接到已有会话
   * 启动 --resume 进程，stdin 保持开放，支持从手机端发送消息
   */
  async spawnConnectSession(options: {
    sessionId: string;
    projectPath?: string;
    model?: string;
  }): Promise<SessionInfo> {
    const { sessionId, projectPath, model } = options;
    const now = Date.now();

    // 读取已有 JSONL 历史（如存在）
    const jsonlPath = JsonlHistory.resolveJsonlPath(sessionId, projectPath);
    let historyMessages: HistoryMessage[] | undefined;
    let sessionModel = model;
    if (jsonlPath) {
      try {
        historyMessages = await JsonlHistory.read(jsonlPath);
        // 从 JSONL 首条 init 行提取模型名
        if (!sessionModel) {
          try {
            const { readFile } = await import('fs/promises');
            const raw = await readFile(jsonlPath, 'utf-8');
            for (const line of raw.split('\n')) {
              try {
                const pl = JSON.parse(line);
                if (pl.type === 'system' && pl.subtype === 'init' && pl.model) {
                  sessionModel = pl.model;
                  break;
                }
              } catch {}
            }
          } catch {}
        }
      } catch {}
    }

    const info: SessionInfo = {
      id: sessionId,
      status: 'idle',
      mode: 'spawn',
      createdAt: now,
      updatedAt: now,
      projectPath,
      model: sessionModel,
    };

    const parser = new StreamParser({ sessionId });
    const session: Session = {
      info,
      process: null,
      parser,
      historyMessages,
      _jsonlPath: jsonlPath || undefined,
    };

    this.sessions.set(sessionId, session);

    // 启动 Claude Code 进程（全控制模式）
    // - 有 JSONL 历史 → --resume（恢复已有对话）
    // - 无 JSONL 历史 → --session-id（全新开始）
    const hasHistory = jsonlPath && existsSync(jsonlPath);
    try {
      const proc = claudeSpawner.spawn({
        sessionId,
        projectPath,
        model: sessionModel,
        resume: Boolean(hasHistory),
        resumePrint: false,
      });

      session.process = proc;
      proc.on('event', (event) => {
        this._handleProcessEvent(sessionId, event);
      });
    } catch (err) {
      this.sessions.delete(sessionId);
      throw err;
    }

    this._broadcastSessionList();
    return info;
  }

  /**
   * 附加到已有会话（只读模式）
   * 读取 JSONL 历史 + 监听文件变化
   */
  async attachSession(options: {
    sessionId: string;
    projectPath?: string;
    /** 热重启恢复时传 true，强制初始状态为 idle（忽略 JSONL 末尾行判断） */
    forceIdle?: boolean;
  }): Promise<SessionInfo> {
    const { sessionId, projectPath } = options;
    const now = Date.now();

    // 如果已存在相同 sessionId 的会话，先关闭旧的再重新 attach
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.watcher) {
        await existing.watcher.stop();
      }
      this.sessions.delete(sessionId);
    }

    // 1. 解析 JSONL 路径
    const jsonlPath = JsonlHistory.resolveJsonlPath(sessionId, projectPath);
    if (!jsonlPath) {
      throw new Error(`找不到会话 ${sessionId} 的 JSONL 文件`);
    }

    // 2. 先读取完整历史（确保包含所有已写入的工具结果）
    const history = await JsonlHistory.read(jsonlPath);

    // 2.3 从 JSONL 首条 system/init 行提取模型名称
    let sessionModel: string | undefined;
    try {
      const { readFile: rf2 } = await import("fs/promises");
      const ri = await rf2(jsonlPath, "utf-8");
      for (const line of ri.split('\n')) {
        try {
          const pl = JSON.parse(line);
          if (pl.type === "system" && pl.subtype === "init" && pl.model) {
            sessionModel = pl.model;
            break;
          }
          if (pl.type !== "system") break;
        } catch {}
      }
    } catch {}

    // 2.5 根据 JSONL 末尾行判断初始状态 + 提取最后活动详情
    let initialStatus: SessionStatus = 'idle';
    let statusDetail: string | undefined;
    try {
      const { readFile } = await import('fs/promises');
      const rawContent = await readFile(jsonlPath, 'utf-8');
      const lines = rawContent.split('\n').filter(l => l.trim());
      let lastToolName: string | undefined;
      let lastTs: number | undefined;
      let foundEnd = false;

      // 第一遍：判定状态并找时间戳
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if ((parsed.type === 'system' && parsed.subtype === 'turn_duration') || (parsed.type === 'result' && parsed.subtype === 'success')) {
            initialStatus = 'idle';
            if (parsed.timestamp) lastTs = parsed.timestamp;
            foundEnd = true;
            // 继续往前看几条找工具名
            for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
              try {
                const p = JSON.parse(lines[j]);
                if (p.type === 'assistant' && p.message?.content) {
                  for (const block of (p.message.content as any[] || [])) {
                    if (block.type === 'tool_use' && block.name) {
                      lastToolName = block.name;
                      break;
                    }
                  }
                  if (lastToolName) break;
                }
              } catch {}
            }
            break;
          }
          if (parsed.isMeta || parsed.isSidechain) continue;
          if (!lastTs) lastTs = parsed.timestamp;
          if (parsed.type === 'user') { initialStatus = 'busy'; break; }
          if (parsed.type === 'assistant') {
            initialStatus = 'idle';
            // 提取工具名
            if (parsed.message?.content) {
              for (const block of (parsed.message.content as any[] || [])) {
                if (block.type === 'tool_use' && block.name) { lastToolName = block.name; break; }
              }
            }
            break;
          }
        } catch { /* 跳过 */ }
      }
      // 生成状态详情
      if (initialStatus === 'idle' && lastTs) {
        const ts = typeof lastTs === 'string' ? new Date(lastTs).getTime() : lastTs;
        if (!isNaN(ts)) {
          const sec = Math.round((Date.now() - ts) / 1000);
          const ago = sec < 60 ? `${sec}秒前` : sec < 3600 ? `${Math.round(sec/60)}分钟前` : `${Math.round(sec/3600)}小时前`;
          statusDetail = lastToolName ? `最后调用 ${lastToolName} · ${ago}` : ago;
        }
      }
    } catch { /* 读取失败 */ }

    // 热重启恢复时强制 idle：重启后没有任何 Claude 进程在运行
    if (options.forceIdle) {
      initialStatus = 'idle';
    }

    // 3. 创建会话信息
    const info: SessionInfo = {
      id: sessionId,
      status: initialStatus,
      statusDetail,
      createdAt: now,
      updatedAt: now,
      projectPath,
      model: sessionModel,
      mode: 'attach',
    };

    // 4. 存储会话（在启动 watcher 之前，确保 sendStateToNewClient 可用）
    const session: Session = {
      info,
      process: null,
      parser: new StreamParser({ sessionId }),
      _jsonlPath: jsonlPath,
      historyMessages: history,
    };
    this.sessions.set(sessionId, session);

    // 5. 广播完整历史
    const historyEvent = createServerEvent('history', {
      messages: history,
      sessionId,
      mode: 'attach',
    }, { sessionId });
    this._broadcastEvent(historyEvent);

    // 6. 广播会话列表更新
    this._broadcastSessionList();

    // 7. 创建 watcher 并注册事件（在 history 读取之后，避免漏掉变化）
    const watcher = new JsonlWatcher(jsonlPath);

    watcher.on('newMessages', (messages: HistoryMessage[]) => {
      for (const msg of messages) {
        // 广播文本内容（token 事件）
        if (msg.content) {
          const event = createServerEvent('stream', {
            text: msg.content,
            messageId: msg.id,
            role: msg.role,
          }, { sessionId, event: 'token' });
          this._broadcastEvent(event);
        }

        // 广播工具调用（tool_use 事件）
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            // AskUserQuestion → 拦截转为 question_request 事件
            if (tc.input) {
              const qData = detectAskUserQuestion(tc.input);
              if (qData) {
                const qEvent = createServerEvent('question_request', {
                  requestId: generateId('q'),
                  toolUseId: tc.id || `${msg.id}-tool`,
                  question: qData.question,
                  options: qData.options,
                }, { sessionId });
                this._broadcastEvent(qEvent);
                continue; // 跳过普通的 tool_use 广播
              }
            }

            const toolEvent = createServerEvent('stream', {
              toolName: tc.name,
              input: tc.input,
              toolUseId: tc.id || `${msg.id}-tool`,
            }, { sessionId, event: 'tool_use' });
            this._broadcastEvent(toolEvent);
          }
        }

        // 广播工具结果（tool_result 事件）
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            const resultEvent = createServerEvent('stream', {
              toolUseId: tr.toolUseId,
              content: tr.content,
              isError: tr.isError,
            }, { sessionId, event: 'tool_result' });
            this._broadcastEvent(resultEvent);
          }
        }
      }

      // 更新缓存的 historyMessages，供新客户端连接时重放
      const sess = this.sessions.get(sessionId);
      if (sess?.historyMessages) {
        for (const msg of messages) {
          // 只缓存有实际内容的消息（跳过空内容消息，避免前端渲染空白气泡）
          if (msg.content && msg.content.trim()) {
            sess.historyMessages.push(msg);
            // 容量上限：保留最近的消息
            if (sess.historyMessages.length > MAX_HISTORY_MESSAGES) {
              sess.historyMessages = sess.historyMessages.slice(-MAX_HISTORY_MESSAGES);
            }
          }
          // 若包含 toolResults，同步更新已有的 toolCalls 结果（不论消息是否有文本内容）
          if (msg.toolResults) {
            for (const tr of msg.toolResults) {
              for (const histMsg of sess.historyMessages) {
                if (histMsg.toolCalls) {
                  for (const tc of histMsg.toolCalls) {
                    if (tc.id === tr.toolUseId) {
                      tc.result = tr.content;
                      tc.isError = tr.isError;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 恢复窗口期（10s）内不更新状态，避免 watcher 轮询覆盖修正
      const sess2 = this.sessions.get(sessionId);
      if (!sess2?._restoreTime || Date.now() - sess2._restoreTime > 10000) {
        this._updateStatus(sessionId, 'busy', '正在生成回复');
      }
    });

    watcher.on('turnComplete', () => {
      const sess3 = this.sessions.get(sessionId);
      if (!sess3?._restoreTime || Date.now() - sess3._restoreTime > 10000) {
        this._updateStatus(sessionId, 'idle', '刚刚');
      }
    });

    watcher.on('fileReset', async () => {
      // 文件被清空（如 /clear）：全量重读 JSONL
      try {
        const latestHistory = await JsonlHistory.read(jsonlPath);
        const sess4 = this.sessions.get(sessionId);
        if (!sess4) return;

        // 如果文件完全为空，说明会话已被 /clear 清除，关闭此会话
        if (!latestHistory || latestHistory.length === 0) {
          console.log(`[Attach] 会话 ${sessionId.slice(0, 8)} JSONL 已清空，自动关闭`);
          await this.closeSession(sessionId);
          return;
        }

        sess4.historyMessages = latestHistory;
        // 广播更新后的历史给所有客户端
        const historyEvent = createServerEvent('history', {
          messages: latestHistory,
          sessionId,
          mode: 'attach',
        }, { sessionId });
        this._broadcastEvent(historyEvent);
        this._updateStatus(sessionId, 'idle', '刚刚');
      } catch (err) {
        console.error(`[${sessionId}] 重载 JSONL 失败:`, (err as Error).message);
      }
    });

    // 8. 修正状态 + 设置恢复时间戳（抑制 watcher 初期干扰）
    session._restoreTime = now;
    if (info.status === 'busy') {
      info.status = 'idle';
      // 保留 JSONL 提取的详情，仅在没有详情时才用默认
      if (!info.statusDetail) {
        info.statusDetail = '（已恢复）';
      }
    }

    // 9. 启动 watcher
    watcher.start();
    session.watcher = watcher;

    // 10. 确保元数据文件存在（断开后能被 scanDiskSessions 发现）
    try {
      const sessionsDir = join(homedir(), '.claude', 'sessions');
      if (!existsSync(sessionsDir)) {
        mkdirSync(sessionsDir, { recursive: true });
      }
      const metaPath = join(sessionsDir, `${sessionId}.json`);
      if (!existsSync(metaPath)) {
        writeFileSync(metaPath, JSON.stringify({
          sessionId,
          cwd: projectPath || process.cwd(),
        }));
      }
    } catch (err) {
      // 写入失败不影响 attach 流程
      console.error(`[Attach] 写入元数据文件失败: ${(err as Error).message}`);
    }

    return info;
  }

  /**
   * 处理进程事件
   */
  private _handleProcessEvent(sessionId: string, event: ClaudeProcessEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.processEventRouter.handle(sessionId, session.parser, event);
  }

  /**
   * 处理客户端指令
   */
  async handleCommand(command: ClientCommand, clientWs?: WebSocket): Promise<void> {
    // 不需要 sessionId 的指令提前处理
    switch (command.action) {
      case 'create_session':
        await this.createSession((command as any).data);
        return;
      case 'switch_session':
        this._handleSwitchSession((command as any).data.targetSessionId, clientWs);
        return;
    }

    const session = this._getSession(command.sessionId);
    if (!session) return;

    switch (command.action) {
      case 'send_message': await this._handleSendMessage(command, session); break;
      case 'interrupt': await this._handleInterrupt(command, session); break;
      case 'approve': this._handleApprove(command, session); break;
      case 'answer': await this._handleAnswer(command, session); break;
      default: console.log('未知指令:', command.action);
    }
  }

  /** 查找并校验 sessionId 对应的会话 */
  private _getSession(sessionId?: string): Session | undefined {
    if (!sessionId) {
      console.error('指令缺少 sessionId');
      return undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`会话 ${sessionId} 不存在`);
    }
    return session;
  }

  /** 处理 send_message 指令 */
  private async _handleSendMessage(rawCommand: ClientCommand, session: Session): Promise<void> {
    const command = rawCommand as SendMessageCommand;
    const sessionId = command.sessionId!;

    // 如果进程已退出，尝试以 --resume 模式重新启动
    if (!session.process || !session.process.isRunning()) {
      // 并发保护：上一次进程的退出清理仍在进行中，阻塞等待
      if (session._cleaningUp) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (!session._cleaningUp) resolve();
            else setTimeout(check, 50);
          };
          check();
        });
      }

      // 暂停 JSONL watcher，防止进程输出与文件监听重复广播
      if (session.watcher) {
        await session.watcher.stop();
      }

      try {
        // 清理 Claude Code 守护进程锁
        try {
          const lockPath = join(homedir(), '.claude', 'tasks', sessionId, '.lock');
          if (existsSync(lockPath)) unlinkSync(lockPath);
        } catch { /* 锁文件不存在或已被清理 */ }

        const isSpawn = session.info.mode === 'spawn';
        const proc = claudeSpawner.spawn({
          sessionId,
          projectPath: session.info.projectPath,
          resume: !isSpawn,
          model: session.info.model,
        });
        session.process = proc;
        proc.on('event', (event) => {
          this._handleProcessEvent(sessionId, event);
        });
        proc.process.once('exit', () => {
          this._onAttachProcessExit(sessionId);
        });
      } catch (err) {
        const errMsg = (err as Error).message || '未知错误';
        console.error(`无法恢复会话 ${sessionId}: ${errMsg}`);
        this._broadcastEvent(createServerEvent('error', {
          code: 'SPAWN_FAILED',
          message: `会话已被主机占用: ${errMsg}`,
        }, { sessionId }));
        if (session.info.mode === 'spawn') {
          this._updateStatus(sessionId, 'stopped', '主机占用中');
          return;
        }
        if (session.watcher) {
          session.watcher.start();
        }
        return;
      }
    }

    const msgData = command.data;

    try {
      session.process.sendMessage(msgData.text);
      this._updateStatus(sessionId, 'busy', '正在发送...');
    } catch (err) {
      console.error(`发送消息失败 [${sessionId}]:`, err);
    }

    if (!session.watcher && msgData.text?.trim()) {
      const userMsg: HistoryMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: msgData.text,
        timestamp: new Date().toISOString(),
      };
      if (!session.historyMessages) session.historyMessages = [];
      session.historyMessages.push(userMsg);
    }
  }

  /** 处理 interrupt 指令 */
  private async _handleInterrupt(command: ClientCommand, session: Session): Promise<void> {
    const sessionId = command.sessionId!;

    if (session.process) {
      session.process.interrupt();
      this._updateStatus(sessionId, 'idle');

      if (session.info.mode === 'spawn') {
        setTimeout(async () => {
          if (!this.sessions.has(sessionId)) return;
          const s = this.sessions.get(sessionId)!;
          if (!s.process || !s.process.isRunning()) {
            try {
              const proc = claudeSpawner.spawn({
                sessionId,
                projectPath: s.info.projectPath,
                resume: true,
                resumePrint: false,
              });
              s.process = proc;
              proc.on('event', (e) => this._handleProcessEvent(sessionId, e));
            } catch {
              console.warn(`[${sessionId}] spawn 中断后重启失败`);
            }
          }
        }, 1000);
      }
    }
  }

  /** 处理 approve 指令 */
  private _handleApprove(rawCommand: ClientCommand, session: Session): void {
    const command = rawCommand as ApproveCommand;
    const sessionId = command.sessionId!;
    const { requestId, decision } = command.data;

    const validDecisions = ['allow', 'deny', 'allow_always'] as const;
    if (!validDecisions.includes(decision as typeof validDecisions[number])) {
      this._broadcastEvent(createServerEvent('error', {
        code: 'INVALID_DECISION',
        message: `无效的审批决策: ${decision}`,
      }, { sessionId }));
      return;
    }

    const pending = this.pendingManager.getApproval(sessionId, requestId);
    if (!pending) {
      this._broadcastEvent(createServerEvent('error', {
        code: 'APPROVAL_EXPIRED',
        message: `审批请求 ${requestId} 已过期或不存在`,
      }, { sessionId }));
      return;
    }

    this.pendingManager.removeApproval(sessionId, requestId);

    if (!session.process || !session.process.isRunning()) {
      this._broadcastEvent(createServerEvent('error', {
        code: 'PROCESS_EXITED',
        message: 'Claude Code 进程已退出，无法发送审批响应',
      }, { sessionId }));
      return;
    }

    try {
      session.process.sendPermissionResponse(pending.toolUseId, decision);
    } catch (err: any) {
      console.error(`发送权限响应失败 [${sessionId}]:`, err?.message);
      this._broadcastEvent(createServerEvent('error', {
        code: 'APPROVAL_SEND_FAILED',
        message: `发送权限响应失败: ${err?.message || '未知错误'}`,
      }, { sessionId }));
      return;
    }

    if (this.pendingManager.getApprovalCount(sessionId) === 0) {
      this._updateStatus(sessionId, 'busy');
    }

    // 广播「审批已处理」通知，让其他设备清除 pendingApproval 弹窗
    this._broadcastEvent(createServerEvent('pending_resolved', {
      kind: 'approval',
      requestId,
    }, { sessionId }));
  }

  /** 处理 answer 指令 */
  private async _handleAnswer(rawCommand: ClientCommand, session: Session): Promise<void> {
    const command = rawCommand as AnswerCommand;
    const sessionId = command.sessionId!;
    const { requestId, answer } = command.data;

    let pending = this.pendingManager.getQuestion(sessionId, requestId);
    if (!pending) {
      pending = this.pendingManager.getAnyQuestion(sessionId);
    }
    if (!pending) {
      this._broadcastEvent(createServerEvent('error', {
        code: 'QUESTION_EXPIRED',
        message: `没有待回答的提问`,
      }, { sessionId }));
      return;
    }

    this.pendingManager.removeQuestion(sessionId, requestId);

    const chosenLabel = pending.options.find(o => o.value === answer)?.label || answer;
    const answerMsg: HistoryMessage = {
      id: `answer-${Date.now()}`,
      role: 'user',
      content: `📱 选择了: ${chosenLabel}`,
      timestamp: new Date().toISOString(),
    };
    if (!session.historyMessages) session.historyMessages = [];
    session.historyMessages.push(answerMsg);
    if (session.historyMessages.length > MAX_HISTORY_MESSAGES) {
      session.historyMessages = session.historyMessages.slice(-MAX_HISTORY_MESSAGES);
    }

    if (session.process?.isRunning()) {
      try {
        session.process.sendToolResult(pending.toolUseId, answer);
      } catch {
        session.process?.sendMessage(`我已在手机端选择: ${chosenLabel}`);
      }
    }
    if (this.pendingManager.getQuestionCount(sessionId) === 0) {
      this._updateStatus(sessionId, 'busy');
    }

    // 广播「提问已解决」通知，让其他设备清除 pendingQuestion 弹窗
    this._broadcastEvent(createServerEvent('pending_resolved', {
      kind: 'question',
      requestId,
    }, { sessionId }));

    this._broadcastEvent(createServerEvent('stream', {
      text: answerMsg.content,
      messageId: answerMsg.id,
      role: 'user',
    }, { sessionId, event: 'token' }));
  }

  /**
   * attach 模式 spawn 的 --resume 持续进程退出时：
   * 1. 重新读取 JSONL 更新 historyMessages 缓存（仅供新客户端重连时重放）
   * 2. 重启 watcher（lastSize 自动设为当前文件大小，避免重复广播）
   * 3. 更新状态
   *
   * 注意：不向已连接客户端广播 history，因为进程 stdout 流式事件已实时推送全部新内容。
   * 广播 history 会触发前端 allMessages.set() 全量替换，覆盖用户刚发送的本地消息。
   */
  private async _onAttachProcessExit(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 非 attach 模式（无 watcher），无需恢复
    if (!session.watcher) return;

    session._cleaningUp = true;
    try {
      // 重新读取完整 JSONL 历史（JSONL 是权威事实源），更新缓存
      const jsonlPath = JsonlHistory.resolveJsonlPath(
        sessionId,
        session.info.projectPath
      );
      if (jsonlPath) {
        const latestHistory = await JsonlHistory.read(jsonlPath);
        session.historyMessages = latestHistory;
        // 广播更新后的历史给所有客户端
        this._broadcastEvent(createServerEvent('history', {
          messages: latestHistory,
          sessionId,
          mode: 'attach',
        }, { sessionId }));
      }
    } catch (err) {
      console.error(`[${sessionId}] 更新 JSONL 历史失败:`, err);
    } finally {
      // 重启 watcher，其 start() 内部将 lastSize 设为当前文件大小
      // 不会重读已处理的行，仅监听后续新增变更
      session.watcher.start();

      // 更新状态：attach 模式的临时 spawn 结束后回到 idle
      this._updateStatus(sessionId, 'idle');

      // 释放清理锁
      session._cleaningUp = false;
    }
  }

  /**
   * 缓存流式事件到 historyMessages（spawn 模式）
   *
   * attach 模式下由 JsonlWatcher 维护 historyMessages，此处跳过以避免重复。
   * spawn 模式下无 watcher，需要在此累积流式输出用于会话切换时回放历史。
   */
  private _cacheStreamEvent(sessionId: string, serverEvent: ServerEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // attach 模式：JsonlWatcher 已在维护 historyMessages，跳过避免重复
    if (session.watcher) return;

    // 仅处理 stream 事件
    if (serverEvent.type !== 'stream') return;

    // 初始化缓存
    if (!session.historyMessages) session.historyMessages = [];
    if (!session._currentTurnMessages) session._currentTurnMessages = [];

    if (serverEvent.event === 'token' && serverEvent.data.text) {
      const lastMsg = session._currentTurnMessages[session._currentTurnMessages.length - 1];
      const msgId = serverEvent.data.messageId || `msg-${Date.now()}`;
      if (lastMsg?.role === 'assistant' && lastMsg.id === msgId) {
        // 同一消息的续写 token
        lastMsg.content += serverEvent.data.text;
      } else {
        // 新消息
        session._currentTurnMessages.push({
          id: msgId,
          role: serverEvent.data.role || 'assistant',
          content: serverEvent.data.text,
          timestamp: new Date().toISOString(),
        });
      }
    } else if (serverEvent.event === 'tool_use') {
      // 在最近一条 assistant 消息上追加 toolCalls
      for (let i = session._currentTurnMessages.length - 1; i >= 0; i--) {
        if (session._currentTurnMessages[i].role === 'assistant') {
          const msg = session._currentTurnMessages[i];
          if (!msg.toolCalls) msg.toolCalls = [];
          msg.toolCalls.push({
            id: serverEvent.data.toolUseId,
            name: serverEvent.data.toolName || '',
            input: serverEvent.data.input || {},
          });
          break;
        }
      }
    } else if (serverEvent.event === 'tool_result') {
      // 匹配 toolUseId，更新 result
      const allMsgs = [...session._currentTurnMessages, ...session.historyMessages];
      for (const msg of allMsgs) {
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            if (tc.id === serverEvent.data.toolUseId) {
              tc.result = serverEvent.data.content;
              tc.isError = serverEvent.data.isError;
            }
          }
        }
      }
    } else if (serverEvent.event === 'result') {
      // 轮次结束：合并当前轮次消息到 historyMessages
      for (const msg of session._currentTurnMessages) {
        if (msg.content?.trim()) {
          session.historyMessages.push(msg);
        }
      }
      // 容量上限：保留最近的消息
      if (session.historyMessages.length > MAX_HISTORY_MESSAGES) {
        session.historyMessages = session.historyMessages.slice(-MAX_HISTORY_MESSAGES);
      }
      session._currentTurnMessages = [];
      // spawn 模式：回复完成后更新状态
      if (!session.watcher) {
        this._updateStatus(sessionId, 'idle', '刚刚');
      }
    }
  }

  /**
   * 处理客户端会话切换请求
   * 发送目标会话的完整历史给请求客户端，并确认切换
   */
  private _handleSwitchSession(targetSessionId: string, clientWs?: WebSocket): void {
    if (!this.wsServer) return;

    const targetSession = this.sessions.get(targetSessionId);

    if (!targetSession) {
      if (clientWs) {
        this.wsServer.sendToClient(clientWs, createServerEvent('error', {
          code: 'SESSION_NOT_FOUND',
          message: `会话 ${targetSessionId} 不存在`,
        }, { sessionId: targetSessionId }));
      }
      return;
    }

    // 发送目标会话的完整历史（仅给请求客户端，非广播）
    if (clientWs && targetSession.historyMessages?.length) {
      this.wsServer.sendToClient(clientWs, createServerEvent('history', {
        messages: targetSession.historyMessages,
        sessionId: targetSessionId,
        mode: targetSession.info.mode || 'spawn',
      }, { sessionId: targetSessionId }));
    }

    // 确认切换
    if (clientWs) {
      this.wsServer.sendToClient(clientWs, createServerEvent('session_switched', {
        sessionId: targetSessionId,
        session: targetSession.info,
      }, { sessionId: targetSessionId }));
    }
  }

  /**
   * 保存当前所有会话状态到磁盘（热重启用）
   * @returns 保存的会话数量
   */
  async saveState(): Promise<number> {
    const persistedSessions: PersistedSession[] = [];

    for (const [, session] of this.sessions) {
      // 尝试解析 JSONL 路径（attach 模式已有，spawn 模式需推导）
      let jsonlPath = session._jsonlPath;
      if (!jsonlPath) {
        jsonlPath = JsonlHistory.resolveJsonlPath(
          session.info.id,
          session.info.projectPath
        ) || undefined;
        // 记录到 session 供后续使用
        if (jsonlPath) session._jsonlPath = jsonlPath;
      }

      const ps: PersistedSession = {
        info: { ...session.info },
        jsonlPath,
      };

      // 缓存 historyMessages 快照（无论哪种模式都保存，用于无 JSONL 时的兜底）
      if (session.historyMessages?.length) {
        ps.historyMessages = session.historyMessages;
      }

      persistedSessions.push(ps);
    }

    // 从 RingBuffer 导出最近 1000 条事件（过滤状态类事件，恢复时会重新广播）
    const allBufferEvents = this.wsServer?.getBuffer().exportRecent(1000) || [];
    const bufferEvents = allBufferEvents.filter(
      (e) => e.type !== 'session_list' && e.type !== 'status_change'
    );
    const lastSeq = this.wsServer?.getBuffer().getLatestSeq() || 0;

    return saveStateFile(persistedSessions, bufferEvents, lastSeq);
  }

  /**
   * 从磁盘恢复会话状态（热重启用）
   * @returns 恢复的会话数量
   */
  async restoreState(): Promise<number> {
    const state = loadStateFile();
    if (!state) return 0;

    let restoredCount = 0;

    for (const ps of state.sessions) {
      try {
        if (ps.jsonlPath && existsSync(ps.jsonlPath) && ps.info.mode !== 'spawn') {
          // 非 spawn 模式 + JSONL 文件存在 → 以 attach 模式重新挂载
          await this.attachSession({
            sessionId: ps.info.id,
            projectPath: ps.info.projectPath,
            forceIdle: true, // 热重启恢复：无条件设为 idle
          });
          restoredCount++;
        } else if (ps.historyMessages?.length) {
          // spawn 模式无 JSONL：创建 stub 会话，仅缓存历史消息
          const info: SessionInfo = {
            ...ps.info,
            status: 'stopped', // 子进程已退出
            mode: 'spawn',
          };

          const session: Session = {
            info,
            process: null,
            parser: new StreamParser({ sessionId: ps.info.id }),
            historyMessages: ps.historyMessages,
                };

          this.sessions.set(ps.info.id, session);
          restoredCount++;
        }
      } catch (err) {
        console.error(`[Restore] 恢复会话 ${ps.info.id} 失败:`, (err as Error).message);
      }
    }

    // 确保所有 parser 的 seq 从恢复后的最大 seq 之后继续，避免新事件被 getSince 过滤
    // 必须在 buffer 恢复之前执行，因为 buffer 恢复会清空并覆盖会话恢复过程中产生的低 seq 事件
    if (state.lastSeq > 0) {
      const nextSeq = state.lastSeq + 1;
      for (const [, session] of this.sessions) {
        session.parser.reset(nextSeq);
      }
    }

    // 恢复 RingBuffer 事件（过滤 session_list/status_change，这些由 restore 后重新广播）
    if (state.bufferEvents.length > 0 && this.wsServer) {
      const events = (state.bufferEvents as ServerEvent[]).filter(
        (e) => e.type !== 'session_list' && e.type !== 'status_change'
      );
      if (events.length > 0) {
        this.wsServer.getBuffer().restoreFromArray(events);
      }
    }

    // 修正所有无活跃进程的会话状态 + 设置恢复时间戳（抑制 watcher 干扰）
    const now = Date.now();
    for (const [, session] of this.sessions) {
      session._restoreTime = now;
      if (!session.process || !session.process.isRunning()) {
        if (session.info.status === 'busy') {
          session.info.status = 'idle';
          session.info.statusDetail = '（已恢复）';
          console.log(`[Restore] 修正会话 ${session.info.id.slice(0,8)} 状态: busy → idle`);
        }
      }
    }

    // 广播恢复后的会话列表
    if (restoredCount > 0) {
      this._broadcastSessionList();
    }

    return restoredCount;
  }

  /**
   * 更新会话状态
   */
  private _updateStatus(sessionId: string, status: SessionStatus, detail?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.info.status = status;
    session.info.statusDetail = detail;
    session.info.updatedAt = Date.now();

    // 广播状态变更
    const event = createServerEvent('status_change', {
      status,
    }, { sessionId });

    this._broadcastEvent(event);
  }

  /**
   * 广播事件到 WebSocket
   */
  private _broadcastEvent(event: ServerEvent): void {
    if (this.wsServer) {
      this.wsServer.broadcast(event);
    }
  }

  /**
   * 广播会话列表
   */
  private _broadcastSessionList(): void {
    const sessions = this._getSortedSessions();
    const event = createServerEvent('session_list', { sessions });
    this._broadcastEvent(event);
  }

  /**
   * 获取所有会话（按项目目录分组 + 最后活动时间排序）
   */
  getSessions(): SessionInfo[] {
    return this._getSortedSessions();
  }

  /**
   * 排序策略：同 projectPath 的会话排在一起，组内按 updatedAt 降序
   * 组间按各组最新 updatedAt 降序
   */
  private _getSortedSessions(): SessionInfo[] {
    const all = Array.from(this.sessions.values()).map(s => s.info);

    // 按 projectPath 分组（无 projectPath 的归为 "未知项目"）
    const groups = new Map<string, SessionInfo[]>();
    for (const info of all) {
      const key = info.projectPath || '(未知项目)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(info);
    }

    // 每组内按 updatedAt 降序
    for (const [, g] of groups) {
      g.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // 组间按各组的最大 updatedAt 降序
    const sorted = Array.from(groups.entries())
      .sort(([, a], [, b]) => {
        const maxA = Math.max(...a.map(s => s.updatedAt));
        const maxB = Math.max(...b.map(s => s.updatedAt));
        return maxB - maxA;
      })
      .flatMap(([, items]) => items);

    return sorted;
  }

  /**
   * 获取单个会话
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info;
  }

  /**
   * 启动状态心跳：每 5 秒推送 session_list 确保客户端状态同步
   * 解决热重启后客户端 RingBuffer 恢复可能导致的过期状态问题
   */
  startHeartbeat(intervalMs = 5000): void {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      this._broadcastSessionList();
    }, intervalMs);
  }

  /**
   * 停止状态心跳
   */
  stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }
  }

  // ── 自动清理 ──
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 启动自动清理：定期扫描已停止的过期会话并关闭
   */
  startAutoCleanup(intervalMs = 30 * 60_000): void {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(() => {
      this._autoCleanup();
    }, intervalMs);
  }

  /**
   * 停止自动清理
   */
  stopAutoCleanup(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * 扫描并关闭已停止的过期会话
   */
  private _autoCleanup(): void {
    const now = Date.now();
    const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 天
    const toClose: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.info.status !== 'stopped') continue;

      // 无 JSONL 路径（spawn 模式且无持久数据）：直接关闭
      if (!session._jsonlPath) {
        toClose.push(id);
        continue;
      }

      // 超过 3 天未更新：从内存关闭（磁盘可重新 attach）
      if (now - session.info.updatedAt > MAX_AGE_MS) {
        toClose.push(id);
      }
    }

    if (toClose.length > 0) {
      console.log(`[Cleanup] 自动关闭 ${toClose.length} 个过期会话`);
      for (const id of toClose) {
        this.closeSession(id).catch((err) => console.error(`[Cleanup] 关闭会话失败 ${id}:`, err));
      }
    }
  }

  /**
   * 关闭会话
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 清理 watcher（attach 模式）
    if (session.watcher) {
      await session.watcher.stop();
    }

    if (session.process) {
      await session.process.gracefulShutdown();
    }

    // 清理审批/提问定时器
    this.pendingManager.clearAll(sessionId);

    this.sessions.delete(sessionId);
    this._broadcastSessionList();

    // 清理 Claude Code 会话锁文件（~/.claude/tasks/<id>/.lock）
    // 残留锁会导致 --session-id 接管时报 "already in use"
    try {
      const lockPath = join(homedir(), '.claude', 'tasks', sessionId, '.lock');
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
        console.log(`[CloseSession] 已删除会话锁: ${sessionId.slice(0, 8)}`);
      }
    } catch {}
  }

  /**
   * 断开会话：停止 watcher → 从内存移除 → 放回磁盘列表
   * 会话元数据和 JSONL 均在磁盘上，用户可在「主机上可用」中重新 attach
   */
  /**
   * 接管会话：从 attach 模式切换到 spawn 模式
   * 1. 停止 watcher
   * 2. 删除 Claude Code 锁文件
   * 3. 启动新的 --session-id 持续进程（完整 stdin/stdout 控制）
   */
  async takeoverSession(sessionId: string): Promise<SessionInfo> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);

    const projectPath = session.info.projectPath;

    // 1. 停止 watcher + 清理
    if (session.watcher) await session.watcher.stop();
    if (session.process?.isRunning()) await session.process.gracefulShutdown();

    // 2. 删除 Claude Code 会话锁文件
    try {
      const lockPath = join(homedir(), '.claude', 'tasks', sessionId, '.lock');
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } catch { /* 锁文件不存在或已被清理 */ }

    // 3. 从旧 session 中移除
    this.sessions.delete(sessionId);

    // 3.5 再次确保锁文件被彻底删除（某些 Claude Code 进程可能重建了锁）
    try {
      const lockPath = join(homedir(), '.claude', 'tasks', sessionId, '.lock');
      if (existsSync(lockPath)) unlinkSync(lockPath);
      // 也尝试删除整个 tasks/<sessionId> 目录
      const taskDir = join(homedir(), '.claude', 'tasks', sessionId);
      if (existsSync(taskDir)) {
        try { unlinkSync(taskDir); } catch { /* 目录不为空 */ }
      }
    } catch { /* 锁文件/目录清理失败，不影响接管 */ }

    // 4. 以 spawn 模式重新创建（--resume TUI 模式，不存在锁冲突，stdin 开放）
    const proc = claudeSpawner.spawn({
      sessionId,
      projectPath,
      model: session.info.model,
      resume: true, // --resume 恢复已有会话
      resumePrint: false, // TUI 模式（非 print），stdin 保持开放
    });

    const parser = new StreamParser({ sessionId });
    const newSession: Session = {
      info: {
        ...session.info,
        status: 'idle',
        mode: 'spawn',
        updatedAt: Date.now(),
      },
      process: proc,
      parser,
      historyMessages: session.historyMessages,
    };

    this.sessions.set(sessionId, newSession);
    proc.on('event', (event) => this._handleProcessEvent(sessionId, event));
    this._broadcastSessionList();

    return newSession.info;
  }

  async detachSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话 ${sessionId} 不存在`);
    }

    // 停止 watcher（仅 attach 模式有）
    if (session.watcher) {
      await session.watcher.stop();
    }

    // 如果有残留进程，也停掉
    if (session.process?.isRunning()) {
      await session.process.gracefulShutdown();
    }

    // 清理审批/提问定时器
    this.pendingManager.clearAll(sessionId);

    // 从内存移除（磁盘文件保留）
    this.sessions.delete(sessionId);
    this._broadcastSessionList();
    console.log(`[Detach] 会话 ${sessionId.slice(0, 8)} 已断开并放回磁盘`);
  }

  /**
   * 关闭会话并删除会话元数据文件（从列表消失）
   * JSONL 对话记录保留在磁盘上，不会丢失
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    // 确保元数据文件存在，使会话能被 scanDiskSessions 发现
    const sessionsDir = join(homedir(), '.claude', 'sessions');
    const metaPath = join(sessionsDir, `${sessionId}.json`);
    const projectPath = session?.info.projectPath || process.cwd();
    const hasMeta = existsSync(metaPath);

    if (!hasMeta) {
      // spawn 会话无元数据文件 → 创建一份用于磁盘列表
      try {
        if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
        writeFileSync(metaPath, JSON.stringify({ sessionId, cwd: projectPath }));
        console.log(`[Delete] 已创建元数据: ${metaPath}`);
      } catch {}
    }

    // 先关闭内存中的会话（即使失败也继续）
    try {
      await this.closeSession(sessionId);
    } catch (err: any) {
      console.error(`[Delete] 关闭会话失败 ${sessionId}: ${err.message}`);
    }
  }

  /**
   * 从磁盘删除未连接的会话（仅删元数据文件，JSONL 对话记录保留在磁盘上）
   */
  static async deleteDiskSession(sessionId: string, projectPath?: string): Promise<void> {
    const metaFilesToDelete: string[] = [];

    // 会话元数据文件（~/.claude/sessions/ 下的 JSON 索引文件）
    const sessionsDir = join(homedir(), '.claude', 'sessions');
    const metaPath = join(sessionsDir, `${sessionId}.json`);
    if (existsSync(metaPath)) {
      metaFilesToDelete.push(metaPath);
    } else {
      // 兜底扫描
      try {
        if (existsSync(sessionsDir)) {
          for (const f of readdirSync(sessionsDir)) {
            if (!f.endsWith('.json')) continue;
            try {
              const data = JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8'));
              if (data.sessionId === sessionId) {
                metaFilesToDelete.push(join(sessionsDir, f));
                break;
              }
            } catch {}
          }
        }
      } catch {}
    }

    // 仅删除元数据文件（JSONL 对话记录保留在磁盘上，不会丢失）
    for (const p of metaFilesToDelete) {
      try {
        unlinkSync(p);
        console.log(`[Delete] 已删除磁盘会话元数据: ${p}`);
      } catch (err: any) {
        console.error(`[Delete] 删除失败 ${p}: ${err.message}`);
      }
    }
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    // 并行关闭所有会话，避免因单个会话卡住影响其余
    await Promise.allSettled(ids.map(id => this.closeSession(id)));
  }

  /**
   * 扫描磁盘上的可用会话（~/.claude/sessions/*.json）
   * 按文件名倒序排列（最新优先）
   */
  static scanDiskSessions(): { sessionId: string; cwd: string }[] {
    const sessionsDir = join(homedir(), '.claude', 'sessions');
    if (!existsSync(sessionsDir)) return [];

    try {
      const results: { sessionId: string; cwd: string; mtimeMs: number }[] = [];
      const files = readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of files) {
        try {
          const fullPath = join(sessionsDir, file);
          const st = statSync(fullPath);
          const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
          if (data.sessionId) {
            results.push({
              sessionId: data.sessionId,
              cwd: data.cwd || process.cwd(),
              mtimeMs: st.mtimeMs,
            });
          }
        } catch { /* 跳过损坏文件 */ }
      }

      results.sort((a, b) => b.mtimeMs - a.mtimeMs);
      // 去重：同一 sessionId 只保留最新的条目
      const seen = new Set<string>();
      return results
        .filter(({ sessionId }) => !seen.has(sessionId) && seen.add(sessionId))
        .map(({ sessionId, cwd }) => ({ sessionId, cwd }));
    } catch {
      return [];
    }
  }
}

// 导出单例
export const sessionManager = new SessionManager();
