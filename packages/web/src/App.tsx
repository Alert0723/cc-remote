/**
 * CC Remote Web 应用入口
 */

import React, { useState, useEffect } from 'react';
import { ChatView } from './components/ChatView.js';
import { ToastContainer } from './components/ToastContainer.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useSessionStore } from './stores/sessionStore.js';

export function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);

  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);

  const { status } = useWebSocket(
    connected ? serverUrl : '',
    connected ? token : ''
  );

  // 从 URL 参数获取连接信息
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('server');
    const t = params.get('token');

    if (url && t) {
      setServerUrl(url);
      setToken(t);
      setConnected(true);
    }
  }, []);

  // 自动选择会话：优先恢复上次选中，否则选第一个
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId) {
      const lastId = localStorage.getItem('cc-current-session');
      const lastExists = lastId && sessions.some(s => s.id === lastId);
      setCurrentSession(lastExists ? lastId! : sessions[0].id);
    }
  }, [sessions, currentSessionId]);

  // 记录用户选择的会话到 localStorage
  useEffect(() => {
    if (currentSessionId) localStorage.setItem('cc-current-session', currentSessionId);
  }, [currentSessionId]);

  if (!connected) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div
          className="flex flex-col items-center px-6 py-8 rounded-2xl"
          style={{
            maxWidth: '320px',
            width: '100%',
          }}
        >
          {/* Logo 区域 */}
          <div
            className="flex items-center justify-center mb-6 rounded-xl"
            style={{
              width: '64px',
              height: '64px',
              background: 'var(--accent-soft)',
              border: '1px solid var(--border-color)',
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* 简洁对话气泡 + 终端图标 */}
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
          </div>

          {/* 标题 */}
          <h1
            className="mb-2 text-center"
            style={{
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              fontSize: '22px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            CC Remote
          </h1>

          {/* 副标题 */}
          <p
            className="text-center mb-6"
            style={{
              fontSize: '14px',
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
              maxWidth: '240px',
            }}
          >
            在手机上远程控制你的 Claude Code 会话
          </p>

          {/* 连接步骤 */}
          <div
            className="w-full rounded-xl p-4 mb-6 space-y-3"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <StepItem
              num={1}
              title="PC 端启动服务"
              desc="在 Claude Code 中运行 cc-remote 启动服务"
            />
            <StepItem
              num={2}
              title="扫描二维码"
              desc="使用手机相机扫描 PC 端显示的二维码"
            />
            <StepItem
              num={3}
              title="开始对话"
              desc="连接成功后即可在手机上发送消息"
            />
          </div>

          {/* 等待提示 */}
          <div className="flex items-center gap-2">
            <span
              className="block rounded-full"
              style={{
                width: '6px',
                height: '6px',
                background: 'var(--text-muted)',
                animation: 'status-pulse 2s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontSize: '13px',
                color: 'var(--text-muted)',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              等待连接…
            </span>
          </div>

          {/* 底部版本 */}
          <span
            className="mt-8"
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            v1.0.0
          </span>
        </div>
      </div>
    );
  }

  return <><ChatView /><ToastContainer /></>;
}

/** 步骤条目 */
function StepItem({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      {/* 序号圆圈 */}
      <div
        className="flex-shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: '22px',
          height: '22px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)',
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: "'Inter Tight', 'Inter', sans-serif",
        }}
      >
        {num}
      </div>

      {/* 文字 */}
      <div className="min-w-0">
        <div
          className="font-semibold mb-0.5"
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}
