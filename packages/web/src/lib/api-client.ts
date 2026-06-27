/**
 * HTTP API 客户端
 */

import type { SessionInfo } from '@cc-remote/shared';

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.token = options.token;
  }

  /**
   * 通用请求方法
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    // 仅在有 body 时设 Content-Type，避免 Fastify 拒绝空 body 的 JSON 请求
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string> || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * 获取所有会话
   */
  async getSessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.request('/api/sessions');
  }

  /**
   * 创建新会话
   */
  async createSession(options: {
    projectPath?: string;
    model?: string;
    resume?: boolean;
  } = {}): Promise<SessionInfo> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * 发送消息
   */
  async sendMessage(sessionId: string, text: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  /**
   * 中断生成
   */
  async interrupt(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${sessionId}/interrupt`, {
      method: 'POST',
    });
  }

  /**
   * 审批权限请求
   */
  async approve(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'allow_always'
  ): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${sessionId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ requestId, decision }),
    });
  }

  /**
   * 健康检查
   */
  async health(): Promise<{ status: string; timestamp: number }> {
    return this.request('/api/health');
  }

  /**
   * 获取可用 Skill 列表（供输入框自动补全）
   */
  async getSkills(): Promise<{ skills: { name: string; description: string; source: string }[] }> {
    return this.request('/api/skills');
  }

  /**
   * 获取磁盘上可用的会话列表（含 attach 状态）
   */
  async getAvailableSessions(): Promise<{
    sessions: { sessionId: string; projectPath: string; attached: boolean }[];
  }> {
    return this.request('/api/sessions/available');
  }

  /**
   * 附加到磁盘上的已有会话
   */
  async attachSession(
    sessionId: string,
    projectPath?: string,
    mode: 'attach' | 'spawn' = 'spawn'
  ): Promise<SessionInfo> {
    return this.request('/api/sessions/attach', {
      method: 'POST',
      body: JSON.stringify({ sessionId, projectPath, mode }),
    });
  }

  /**
   * 断开 attach 模式会话（停止监听 → 状态变为 stopped）
   */
  async detachSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${sessionId}/detach`, {
      method: 'POST',
    });
  }

  /**
   * 关闭并删除会话（从内存移除 + 删除磁盘文件）
   */
  async closeSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async takeoverSession(sessionId: string): Promise<SessionInfo> {
    return this.request(`/api/sessions/${sessionId}/takeover`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /**
   * 从磁盘删除未连接的会话（无需先 attach）
   */
  async deleteDiskSession(sessionId: string, projectPath?: string): Promise<{ success: boolean }> {
    return this.request(`/api/sessions/disk/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ projectPath }),
    });
  }

  /**
   * 热重启服务端（保存状态 → 广播通知 → 进程重启）
   */
  async restartServer(): Promise<{ status: string; savedSessions: number }> {
    return this.request('/api/restart', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}
