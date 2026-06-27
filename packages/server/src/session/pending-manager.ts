/**
 * 审批 / 提问生命周期管理器
 * 封装 pendingApprovals 和 pendingQuestions 的 Map 操作与超时管理
 */

export interface ApprovalEntry {
  toolUseId: string;
  toolName: string;
  command?: string;
  timestamp: number;
}

export interface QuestionEntry {
  toolUseId: string;
  question: string;
  options: Array<{ label: string; value: string }>;
  timestamp: number;
}

type TimeoutCallback = (sessionId: string, requestId: string) => void;

/**
 * 审批/提问状态管理器
 * 每个请求按 (sessionId, requestId) 双重索引，自动管理超时定时器
 */
export class PendingManager {
  private approvals = new Map<string, Map<string, ApprovalEntry>>();
  private approvalTimeouts = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  private questions = new Map<string, Map<string, QuestionEntry>>();
  private questionTimeouts = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

  // ── 审批 ──

  /** 注册审批请求并启动超时定时器 */
  addApproval(
    sessionId: string, requestId: string, entry: ApprovalEntry,
    timeoutMs: number, onTimeout: TimeoutCallback,
  ): void {
    if (!this.approvals.has(sessionId)) this.approvals.set(sessionId, new Map());
    this.approvals.get(sessionId)!.set(requestId, entry);

    const timer = setTimeout(() => {
      const stillPending = this.removeApproval(sessionId, requestId);
      if (stillPending) onTimeout(sessionId, requestId);
    }, timeoutMs);

    if (!this.approvalTimeouts.has(sessionId)) this.approvalTimeouts.set(sessionId, new Map());
    this.approvalTimeouts.get(sessionId)!.set(requestId, timer);
  }

  /** 获取审批请求信息 */
  getApproval(sessionId: string, requestId: string): ApprovalEntry | undefined {
    return this.approvals.get(sessionId)?.get(requestId);
  }

  /** 移除审批请求（清除超时），返回被移除的 entry 或 undefined */
  removeApproval(sessionId: string, requestId: string): ApprovalEntry | undefined {
    const timer = this.approvalTimeouts.get(sessionId)?.get(requestId);
    if (timer) clearTimeout(timer);
    this.approvalTimeouts.get(sessionId)?.delete(requestId);
    const entry = this.approvals.get(sessionId)?.get(requestId);
    this.approvals.get(sessionId)?.delete(requestId);
    return entry;
  }

  /** 当前会话的待审批数量 */
  getApprovalCount(sessionId: string): number {
    return this.approvals.get(sessionId)?.size || 0;
  }

  /** 获取指定会话所有待审批请求的 ID（用于广播取消事件） */
  getApprovalRequestIds(sessionId: string): string[] {
    return Array.from(this.approvals.get(sessionId)?.keys() || []);
  }

  // ── 提问 ──

  /** 注册提问请求并启动超时定时器 */
  addQuestion(
    sessionId: string, requestId: string, entry: QuestionEntry,
    timeoutMs: number, onTimeout: TimeoutCallback,
  ): void {
    if (!this.questions.has(sessionId)) this.questions.set(sessionId, new Map());
    this.questions.get(sessionId)!.set(requestId, entry);

    const timer = setTimeout(() => {
      const stillPending = this.removeQuestion(sessionId, requestId);
      if (stillPending) onTimeout(sessionId, requestId);
    }, timeoutMs);

    if (!this.questionTimeouts.has(sessionId)) this.questionTimeouts.set(sessionId, new Map());
    this.questionTimeouts.get(sessionId)!.set(requestId, timer);
  }

  /** 获取提问请求信息 */
  getQuestion(sessionId: string, requestId: string): QuestionEntry | undefined {
    return this.questions.get(sessionId)?.get(requestId);
  }

  /** 移除提问请求（清除超时），返回被移除的 entry 或 undefined */
  removeQuestion(sessionId: string, requestId: string): QuestionEntry | undefined {
    const timer = this.questionTimeouts.get(sessionId)?.get(requestId);
    if (timer) clearTimeout(timer);
    this.questionTimeouts.get(sessionId)?.delete(requestId);
    const entry = this.questions.get(sessionId)?.get(requestId);
    this.questions.get(sessionId)?.delete(requestId);
    return entry;
  }

  /** 当前会话的待回答提问数量 */
  getQuestionCount(sessionId: string): number {
    return this.questions.get(sessionId)?.size || 0;
  }

  // ── 批量清理 ──

  /** 获取任意待审批请求（用于 fallback 查找） */
  getAnyApproval(sessionId: string): ApprovalEntry | undefined {
    return this.approvals.get(sessionId)?.values().next().value;
  }

  /** 获取任意待回答提问（用于 fallback 查找） */
  getAnyQuestion(sessionId: string): QuestionEntry | undefined {
    return this.questions.get(sessionId)?.values().next().value;
  }

  /** 清空指定会话的所有审批和提问（含超时定时器） */
  clearAll(sessionId: string): void {
    // 清除审批
    for (const timer of this.approvalTimeouts.get(sessionId)?.values() || []) {
      clearTimeout(timer);
    }
    this.approvals.delete(sessionId);
    this.approvalTimeouts.delete(sessionId);

    // 清除提问
    for (const timer of this.questionTimeouts.get(sessionId)?.values() || []) {
      clearTimeout(timer);
    }
    this.questions.delete(sessionId);
    this.questionTimeouts.delete(sessionId);
  }
}
