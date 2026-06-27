/**
 * 聊天视图
 * 整合消息列表、输入框、连接状态、主题切换、流式指示器、消息索引
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { MessageList } from './MessageList.js';
import type { MessageListHandle } from './MessageList.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { InputBar } from './InputBar.js';
import { MessageIndexPanel } from './MessageIndexPanel.js';
import { ApprovalDialog } from './ApprovalDialog.js';
import { QuestionDialog } from './QuestionDialog.js';
import { SessionDrawer } from './SessionDrawer.js';
import { useSessionStore } from '../stores/sessionStore.js';
import type { Message } from '../stores/sessionStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { showToast } from '../lib/toast.js';
import { detectAskUserQuestion } from '@cc-remote/shared';

const EMPTY_MESSAGES: Message[] = [];

/** 写入剪贴板（Clipboard API + execCommand 兜底） */
function copyText(text: string): boolean {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0.01;font-size:16px;';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch { return false; }
}

export function ChatView() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const messages = useSessionStore((s) => {
    if (!currentSessionId) return EMPTY_MESSAGES;
    return s.messages.get(currentSessionId) || EMPTY_MESSAGES;
  });
  const sessions = useSessionStore((s) => s.sessions);
  const pendingApproval = useSessionStore((s) => s.pendingApproval);
  const pendingQuestion = useSessionStore((s) => s.pendingQuestion);
  const approve = useSessionStore((s) => s.approve);
  const answer = useSessionStore((s) => s.answer);
  const reconnectSession = useSessionStore((s) => s.reconnectSession);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const debugMode = useThemeStore((s) => s.debugMode);
  const toggleDebug = useThemeStore((s) => s.toggleDebug);

  const messageListRef = useRef<MessageListHandle>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const debugMenuRef = useRef<HTMLDivElement>(null);
  const createSession = useSessionStore((s) => s.createSession);
  const isConnected = useConnectionStore((s) => s.status) === 'connected';
  const apiClient = useConnectionStore((s) => s.apiClient);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const isBusy = currentSession?.status === 'busy';
  const showTyping = isBusy && messages.length > 0;

  const handleScrollToMessage = useCallback((index: number) => {
    messageListRef.current?.scrollToIndex(index);
  }, []);

  // 检测消息中的 AskUserQuestion，弹出提问弹窗（扫描全部消息，messageId 去重）
  const shownQuestions = useRef<Set<string>>(new Set(
    JSON.parse(localStorage.getItem('cc-shown-questions') || '[]')
  ));
  const [scanTick, setScanTick] = useState(0);
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => setScanTick(t => t + 1), 300);
    return () => clearTimeout(timer);
  }, [messages.length]);
  useEffect(() => {
    // 会话已停止或未选中 → 不弹出提问弹窗
    if (!currentSessionId || currentSession?.status === 'stopped') return;
    for (const msg of messages) {
      const inputs: Record<string, unknown>[] = [];
      if (msg.toolInput) inputs.push(msg.toolInput);
      msg.toolCalls?.forEach(tc => { if (tc.input) inputs.push(tc.input); });
      for (const input of inputs) {
        const qData = detectAskUserQuestion(input);
        if (!qData) continue;
        const key = msg.id + ':' + qData.question;
        if (shownQuestions.current.has(key)) continue;
        shownQuestions.current.add(key);
        localStorage.setItem('cc-shown-questions', JSON.stringify([...shownQuestions.current]));
        useSessionStore.setState({
          pendingQuestion: {
            requestId: `q-${Date.now()}`,
            sessionId: currentSessionId || '',
            question: qData.question,
            options: qData.options,
          },
        });
      }
    }
  }, [messages, scanTick]);

  // Debug 菜单：点击外部关闭
  useEffect(() => {
    if (!debugMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (debugMenuRef.current && !debugMenuRef.current.contains(e.target as Node)) {
        setDebugMenuOpen(false);
        setRestartConfirm(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [debugMenuOpen]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setRestartConfirm(false);
    try {
      if (apiClient) await apiClient.restartServer();
    } catch { /* 服务端可能已关闭连接 */ }
    setTimeout(() => {
      setRestarting(false);
      setDebugMenuOpen(false);
    }, 2000);
  }, [apiClient]);

  return (
    <div className="flex flex-col" style={{ height: '100dvh', background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <header
        className="flex items-center justify-between flex-shrink-0 relative"
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          paddingLeft: '24px',
          paddingRight: '24px',
          paddingTop: '10px',
          paddingBottom: '10px',
        }}
      >
        <div className="flex items-center gap-3">
          {/* 会话选择按钮 */}
          <button
            onClick={() => setSessionDrawerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg transition-all duration-150"
            style={{
              padding: '4px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M2 8h10M2 12h7" />
            </svg>
            <span>会话</span>
          </button>

          <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />
          <ConnectionStatus />
          {currentSessionId && (
            <button
              onClick={() => {
                const ok = copyText(currentSessionId);
                if (ok) showToast('已复制对话 ID', 'success', 1500);
              }}
              title="点击复制对话 ID"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: '10px', fontFamily: "'JetBrains Mono', monospace",
                flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {currentSessionId.slice(0, 8)}…
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 消息索引按钮 */}
          <button
            onClick={() => setIndexOpen(!indexOpen)}
            className="flex items-center justify-center rounded-lg transition-all duration-150"
            style={{
              width: '32px',
              height: '32px',
              background: indexOpen ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
              border: `1px solid ${indexOpen ? 'var(--accent)' : 'var(--border-color)'}`,
              cursor: 'pointer',
              color: indexOpen ? 'var(--accent)' : 'var(--text-secondary)',
            }}
            title="消息索引"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 3h12M2 8h8M2 13h5" />
            </svg>
          </button>

          {/* 主题切换 */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center rounded-lg transition-all duration-150"
            style={{
              width: '32px',
              height: '32px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
            title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="4" />
                <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11l-1.06-1.06" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M13.5 10.5A5.5 5.5 0 0 1 5.5 2.5 5.5 5.5 0 1 0 13.5 10.5z" />
              </svg>
            )}
          </button>
        </div>

        {/* 消息索引下拉面板 */}
        {indexOpen && (
          <MessageIndexPanel
            messages={messages}
            onScrollTo={handleScrollToMessage}
            onClose={() => setIndexOpen(false)}
          />
        )}
      </header>

      {/* 无会话空状态 */}
      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
          <div
            className="flex flex-col items-center px-8 py-10 mx-4 text-center"
            style={{
              borderRadius: '16px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              maxWidth: '300px',
              width: '100%',
            }}
          >
            <div
              className="flex items-center justify-center mb-4"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <h2
              style={{
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
                fontSize: '16px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
                marginBottom: '6px',
              }}
            >
              暂无会话
            </h2>
            <p
              style={{
                fontSize: '13px',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
                maxWidth: '220px',
              }}
            >
              点击下方按钮创建新的 Claude Code 会话
            </p>
          </div>
        </div>
      ) : !currentSessionId ? (
        /* 有会话但未选中（如全部已停止）：引导从抽屉选择 */
        <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
          <div
            className="flex flex-col items-center px-8 py-10 mx-4 text-center"
            style={{
              borderRadius: '16px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              maxWidth: '300px',
              width: '100%',
            }}
          >
            <div
              className="flex items-center justify-center mb-4"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'rgba(255,193,7,0.12)',
                color: 'var(--warning)',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2
              style={{
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
                fontSize: '16px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
                marginBottom: '6px',
              }}
            >
              会话已断开
            </h2>
            <p
              style={{
                fontSize: '13px',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
                maxWidth: '220px',
              }}
            >
              点击左上角「会话」按钮，从列表中选择一个会话重新连接
            </p>
          </div>
        </div>
      ) : (
        <MessageList ref={messageListRef} messages={messages} isStreaming={showTyping} />
      )}

      {/* 当前会话已停止 → 轻量提示 + 重连入口 + Debug */}
      {currentSession?.status === 'stopped' ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--text-muted)', flexShrink: 0,
          }} />
          <span style={{
            fontSize: '13px', color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif", flex: 1,
          }}>
            会话已断开
          </span>
          <button
            onClick={async () => {
              if (!currentSessionId) return;
              setReconnecting(true);
              try {
                await reconnectSession(currentSessionId);
                showToast('已重新连接', 'success');
              } catch (err: any) {
                showToast(`重连失败: ${err?.message || '未知错误'}`, 'error', 3000);
              } finally {
                setReconnecting(false);
              }
            }}
            disabled={reconnecting}
            style={{
              padding: 0,
              border: 'none', background: 'none',
              color: reconnecting ? 'var(--text-muted)' : 'var(--accent)',
              fontSize: '13px', fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: reconnecting ? 'default' : 'pointer',
              opacity: reconnecting ? 0.5 : 1,
            }}
          >
            {reconnecting ? '连接中…' : '重新连接'}
          </button>

          {/* Debug 入口（断线时也能用） */}
          <div ref={debugMenuRef} style={{ position: 'relative' }}>
            {debugMenuOpen && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', bottom: '100%', right: 0,
                  marginBottom: '8px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-color)', borderRadius: '12px',
                  boxShadow: '0 -4px 20px rgba(0,0,0,0.3)', minWidth: '180px',
                  overflow: 'hidden', zIndex: 50,
                  animation: 'slide-up 0.15s ease both',
                }}
              >
                <button
                  onClick={() => { toggleDebug(); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '12px 16px', border: 'none',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'transparent', color: 'var(--text-primary)',
                    fontSize: '13px', fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                  }}
                >
                  <span>调试模式</span>
                  <span style={{
                    width: '36px', height: '20px', borderRadius: '10px',
                    background: debugMode ? 'var(--accent)' : 'var(--bg-tertiary)',
                    border: `1px solid ${debugMode ? 'var(--accent)' : 'var(--border-color)'}`,
                    position: 'relative', transition: 'all 0.2s', flexShrink: 0,
                  }}>
                    <span style={{
                      position: 'absolute', top: '2px',
                      left: debugMode ? '17px' : '2px',
                      width: '14px', height: '14px', borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </span>
                </button>
                {restartConfirm ? (
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--danger)', fontFamily: "'Inter', sans-serif" }}>重启？</span>
                    <button onClick={handleRestart} style={{
                      padding: '4px 12px', borderRadius: '6px', border: 'none',
                      background: 'var(--danger)', color: '#fff', fontSize: '12px',
                      fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                    }}>确认</button>
                    <button onClick={() => setRestartConfirm(false)} style={{
                      padding: '4px 12px', borderRadius: '6px',
                      border: '1px solid var(--border-color)', background: 'transparent',
                      color: 'var(--text-secondary)', fontSize: '12px',
                      fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                    }}>取消</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRestartConfirm(true)}
                    disabled={restarting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                      padding: '12px 16px', border: 'none', background: 'transparent',
                      color: restarting ? 'var(--text-muted)' : 'var(--danger)',
                      fontSize: '13px', fontFamily: "'Inter', sans-serif",
                      cursor: restarting ? 'default' : 'pointer',
                      opacity: restarting ? 0.6 : 1,
                    }}
                  >
                    {restarting ? (
                      <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 8A6 6 0 1 1 8 2" /></svg>
                      </span>重启中…</>
                    ) : (
                      <><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8a6 6 0 0 1 10.5-4" /><path d="M14 8a6 6 0 0 1-10.5 4" /><path d="M12.5 1v3.5H9" /><path d="M3.5 15v-3.5H7" /></svg>重启服务</>
                    )}
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => { setDebugMenuOpen(v => !v); setRestartConfirm(false); }}
              title="调试工具"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '10px',
                border: `1px solid ${debugMode ? 'var(--warning)' : debugMenuOpen ? 'var(--accent)' : 'var(--border-color)'}`,
                background: debugMode ? 'var(--warning-bg)' : debugMenuOpen ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                color: debugMode ? 'var(--warning)' : debugMenuOpen ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: '11px', fontWeight: 500, fontFamily: "'Inter', sans-serif",
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3v4l-3 2v2h12v-2l-3-2V3M8 3v4" />
                <circle cx="8" cy="2" r="1" fill="currentColor" />
              </svg>
              Debug
            </button>
          </div>
        </div>
      ) : (
        <InputBar />
      )}

      {/* 悬浮新建按钮：仅无会话时显示 */}
      {isConnected && sessions.length === 0 && (
        <>
          {fabOpen && (
            <div style={{
              position: 'fixed', bottom: '80px', right: '16px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
              borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              zIndex: 150, overflow: 'hidden', minWidth: '160px',
              animation: 'slide-up 0.15s ease both',
            }}>
              <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>新建会话</div>
              {[...new Set(sessions.map(s => s.projectPath).filter(Boolean) as string[])].map(p => (
                <button key={p} onClick={() => { createSession({ projectPath: p }); setFabOpen(false); }}
                  style={{ display: 'block', width: '100%', padding: '10px 14px', border: 'none', borderTop: '1px solid var(--border-color)',
                    background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer', textAlign: 'left',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p ? (function(){ const n=p.replace(/\\/g,'/'); return n.length>30?'.../'+n.split('/').filter(Boolean).slice(-2).join('/'):n; })() : '（当前目录）'}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setFabOpen(v => !v)} style={{
            position: 'fixed', bottom: '80px', right: '16px',
            width: '44px', height: '44px', borderRadius: '50%',
            background: fabOpen ? 'var(--bg-tertiary)' : 'var(--accent)',
            color: fabOpen ? 'var(--text-secondary)' : '#fff',
            border: `1px solid ${fabOpen ? 'var(--border-color)' : 'var(--accent)'}`,
            fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 151, transition: 'all 0.2s',
            boxShadow: '0 4px 16px rgba(108,123,255,0.3)',
          }}>
            {fabOpen ? '✕' : '+'}
          </button>
        </>
      )}

      {/* 会话抽屉 */}
      <SessionDrawer
        open={sessionDrawerOpen}
        onClose={() => setSessionDrawerOpen(false)}
      />

      {/* 权限审批弹窗 */}
      {pendingApproval && (
        <ApprovalDialog
          toolName={pendingApproval.toolName}
          command={pendingApproval.command}
          options={pendingApproval.options}
          onApprove={approve}
        />
      )}

      {/* AI 提问弹窗 */}
      {pendingQuestion ? (
        <QuestionDialog
          question={pendingQuestion.question}
          options={pendingQuestion.options}
          onAnswer={(value) => {
            // 标记已回答，不再显示重新打开按钮
            localStorage.setItem('cc-question-answered', pendingQuestion.requestId);
            answer(value);
          }}
          onDismiss={() => {
            localStorage.removeItem('cc-shown-questions');
            localStorage.removeItem('cc-question-answered');
            useSessionStore.setState({ pendingQuestion: null });
          }}
        />
      ) : (() => {
        // 会话已停止或未选中 → 不显示「回答问题」按钮
        if (!currentSessionId || currentSession?.status === 'stopped') return null;
        const answeredId = localStorage.getItem('cc-question-answered');
        if (answeredId) return null;
        for (const m of messages) {
          const inputs: Record<string, unknown>[] = [];
          if (m.toolInput) inputs.push(m.toolInput);
          m.toolCalls?.forEach(tc => { if (tc.input) inputs.push(tc.input); });
          for (const inp of inputs) {
            const qData = detectAskUserQuestion(inp);
            if (qData) {
              return (
                <div
                  onClick={() => {
                    useSessionStore.setState({
                      pendingQuestion: {
                        requestId: `q-${Date.now()}`,
                        sessionId: currentSessionId || '',
                        question: qData.question,
                        options: qData.options,
                      },
                    });
                  }}
                  style={{
                    position: 'fixed', bottom: '120px', right: '16px',
                    background: 'var(--accent)', color: '#fff', padding: '8px 14px', borderRadius: '16px',
                    fontSize: '13px', fontWeight: 600, fontFamily: "'Inter', sans-serif",
                    cursor: 'pointer', zIndex: 9999, boxShadow: '0 4px 16px rgba(108,123,255,0.4)',
                    animation: 'slide-up 0.2s ease both',
                  }}
                >
                  📋 回答问题
                </div>
              );
            }
          }
        }
        return null;
      })()}
    </div>
  );
}
