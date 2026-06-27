/**
 * 输入框组件
 * 多行文本输入 + 发送/中断按钮 + 会话选择器
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { Kbd } from './Kbd.js';
import { showToast } from '../lib/toast.js';

interface SkillInfo { name: string; description: string; }

export function InputBar() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [acOpen, setAcOpen] = useState(false);
  const [acFilter, setAcFilter] = useState('');
  const [acIdx, setAcIdx] = useState(0);

  // 输入历史
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const savedDraft = useRef('');

  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interrupt = useSessionStore((s) => s.interrupt);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);

  const connectionStatus = useConnectionStore((s) => s.status);
  const isConnected = connectionStatus === 'connected';
  const debugMode = useThemeStore((s) => s.debugMode);
  const toggleDebug = useThemeStore((s) => s.toggleDebug);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const debugMenuRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部关闭
  useEffect(() => {
    if (!debugMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // 检查点击是否在菜单容器内，或者在 Debug 按钮上
      if (debugMenuRef.current && !debugMenuRef.current.contains(target)) {
        setDebugMenuOpen(false);
        setRestartConfirm(false);
      }
    };
    // 延迟添加事件监听，避免当前点击立即触发关闭
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [debugMenuOpen]);

  const handleRestart = async () => {
    setRestarting(true);
    setRestartConfirm(false);
    try {
      const { apiClient } = useConnectionStore.getState();
      if (apiClient) {
        await apiClient.restartServer();
      }
    } catch {
      // 服务端可能已关闭连接，忽略
    }
    // 2s 后关闭菜单，客户端会自动重连
    setTimeout(() => {
      setRestarting(false);
      setDebugMenuOpen(false);
    }, 2000);
  };

  // 自动调整文本框高度（MUST 在条件 return 之前，遵守 React Hooks 规则）
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + 'px';
    }
  }, [text]);

  // 拉取可用 Skill 列表供自动补全
  useEffect(() => {
    if (!isConnected) return;
    const { apiClient } = useConnectionStore.getState();
    if (!apiClient) return;
    apiClient.getSkills?.().then((data: any) => {
      if (data?.skills) setSkills(data.skills);
    }).catch(() => {});
  }, [isConnected]);

  // 检测 / 输入并过滤匹配的 Skill
  const handleTextChange = useCallback((value: string, cursorPos: number) => {
    setText(value);
    const idx = Math.min(cursorPos, value.length);
    const before = value.slice(0, idx);
    const slashIdx = before.lastIndexOf('/');
    // 仅当 / 位于输入开头或换行后才触发（前面有其他内容包括空格都不触发）
    const isValidSlash = slashIdx >= 0 && (slashIdx === 0 || before[slashIdx - 1] === '\n');
    if (isValidSlash && slashIdx === before.length - 1) {
      // 刚输入 /，展示全部
      setAcOpen(true);
      setAcFilter('');
      setAcIdx(0);
    } else if (isValidSlash) {
      const q = before.slice(slashIdx + 1).toLowerCase();
      const matches = skills.filter(s => s.name.toLowerCase().startsWith(q));
      if (matches.length > 0) {
        setAcOpen(true);
        setAcFilter(q);
        setAcIdx(0);
      } else {
        setAcOpen(false);
      }
    } else {
      setAcOpen(false);
    }
  }, [skills]);

  const selectSkill = (name: string) => {
    const val = text;
    const cursorPos = textareaRef.current?.selectionStart || val.length;
    const before = val.slice(0, cursorPos);
    const slashIdx = before.lastIndexOf('/');
    if (slashIdx >= 0) {
      const newText = val.slice(0, slashIdx) + '/' + name + ' ' + val.slice(cursorPos);
      setText(newText);
    }
    setAcOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const filteredSkills = acOpen
    ? skills.filter(s => s.name.toLowerCase().startsWith(acFilter.toLowerCase())).slice(0, 6)
    : [];

  // 无会话：显示底部提示
  if (sessions.length === 0) {
    return (
      <div
        className="py-3"
        style={{
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          paddingLeft: '16px',
          paddingRight: '16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '13px',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        点击右下角 + 新建会话
      </div>
    );
  }

  const handleSend = async () => {
    if (!text.trim() || !currentSessionId) return;

    const msg = text.trim();
    await sendMessage(msg);
    setHistory(h => [...h, msg]);
    setHistoryIdx(-1);
    savedDraft.current = '';
    setText('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const navigateHistory = (dir: 'up' | 'down') => {
    if (history.length === 0) return;
    let newIdx: number;
    if (dir === 'up') {
      if (historyIdx === -1) savedDraft.current = text;
      newIdx = Math.min(historyIdx + 1, history.length - 1);
    } else {
      newIdx = historyIdx - 1;
    }
    setHistoryIdx(newIdx);
    if (newIdx === -1) {
      setText(savedDraft.current);
    } else {
      setText(history[history.length - 1 - newIdx]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 上下键：输入历史导航
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistory('up');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistory('down');
      return;
    }
    // Skill 自动补全键盘导航
    if (acOpen && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx(i => Math.min(i + 1, filteredSkills.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSkill(filteredSkills[acIdx].name);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setAcOpen(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInterrupt = () => {
    interrupt();
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const isBusy = currentSession?.status === 'busy';
  const isWaitingApproval = currentSession?.status === 'waiting_approval';

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        padding: '16px 20px',
        // 底部安全区域适配（iOS）
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
      }}
    >
      {/* 输入卡片 */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '24px',
          border: '1px solid var(--border-color)',
          padding: '6px 8px 6px 20px',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          boxShadow: text.trim()
            ? '0 0 0 2px var(--accent-soft)'
            : '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        {/* Skill 自动补全 */}
        {acOpen && filteredSkills.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0,
            marginBottom: '6px', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)', borderRadius: '12px',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.25)', overflow: 'hidden',
            zIndex: 50, maxHeight: '200px', overflowY: 'auto',
          }}>
            {filteredSkills.map((s, i) => (
              <button
                key={s.name}
                onClick={() => selectSkill(s.name)}
                onMouseEnter={() => setAcIdx(i)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 16px', border: 'none',
                  background: i === acIdx ? 'var(--accent-soft)' : 'transparent',
                  color: 'var(--text-primary)', cursor: 'pointer',
                  fontSize: '13px', fontFamily: "'Inter', sans-serif",
                }}
              >
                <span style={{ fontWeight: 600 }}>/{s.name}</span>
                {s.description && <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '11px' }}>{s.description}</span>}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-form-type="other"
          onChange={(e) => {
            setText(e.target.value);
            handleTextChange(e.target.value, e.target.selectionStart || e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            !isConnected
              ? '未连接'
              : isWaitingApproval
                ? '等待权限审批中…'
                : '输入消息…'
          }
          disabled={!isConnected || !currentSessionId || isWaitingApproval}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontFamily: "'Inter', sans-serif",
            fontSize: '16px',
            lineHeight: 1.5,
            outline: 'none',
            padding: '10px 0',
            minHeight: '44px',
            maxHeight: '180px',
            opacity: (!isConnected || !currentSessionId) ? 0.4 : 1,
            caretColor: 'var(--accent)',
          }}
        />

        {/* 中断/发送按钮 */}
        {(isBusy || isWaitingApproval) ? (
          <button
            onClick={handleInterrupt}
            disabled={!isConnected}
            style={{
              flexShrink: 0,
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              cursor: isConnected ? 'pointer' : 'not-allowed',
              opacity: isConnected ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
              boxShadow: '0 2px 8px rgba(239,68,68,0.35)',
            }}
            title="停止生成"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="4" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!isConnected || !text.trim() || !currentSessionId}
            style={{
              flexShrink: 0,
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: isConnected && text.trim() && currentSessionId ? 'pointer' : 'default',
              background: isConnected && text.trim() && currentSessionId
                ? 'var(--accent)'
                : 'var(--bg-tertiary)',
              color: isConnected && text.trim() && currentSessionId
                ? '#fff'
                : 'var(--text-muted)',
              transition: 'all 0.2s',
              transform: isConnected && text.trim() && currentSessionId
                ? 'scale(1)'
                : 'scale(0.92)',
              boxShadow: isConnected && text.trim() && currentSessionId
                ? '0 2px 10px rgba(99,102,241,0.4)'
                : 'none',
            }}
            title="发送消息 (Enter)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="3" x2="12" y2="21" />
              <polyline points="5 12 12 19 19 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 快捷键提示 + /命令按钮 + Debug 开关 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '10px',
        paddingLeft: '8px',
        paddingRight: '4px',
      }}>
        {/* 左侧：连接相关操作（仅在线时可见） */}
        {isConnected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* 输入历史 ↑↓ */}
            <button
              onClick={() => navigateHistory('up')}
              disabled={history.length === 0 || historyIdx >= history.length - 1}
              title="上一条"
              style={{
                padding: '2px 6px', borderRadius: '6px', border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                fontSize: '14px', cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                opacity: (history.length > 0 && historyIdx < history.length - 1) ? 1 : 0.3,
                lineHeight: '1',
              }}
            >
              ↑
            </button>
            <button
              onClick={() => navigateHistory('down')}
              disabled={historyIdx <= -1}
              title="下一条"
              style={{
                padding: '2px 6px', borderRadius: '6px', border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                fontSize: '14px', cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                opacity: historyIdx >= 0 ? 1 : 0.3,
                lineHeight: '1',
              }}
            >
              ↓
            </button>

            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Kbd>↵</Kbd> 发送
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Kbd>⇧↵</Kbd> 换行
            </span>

            {/* 竖线 + / 命令按钮 */}
            <span style={{ width: '1px', height: '12px', background: 'var(--border-color)' }} />
            <button
              onClick={() => {
                const cur = textareaRef.current;
                const pos = cur?.selectionStart ?? text.length;
                const before = text.slice(0, pos);
                const after = text.slice(pos);
                const sep = (before.length > 0 && before[before.length - 1] !== ' ' && before[before.length - 1] !== '\n') ? ' ' : '';
                const newText = before + sep + '/' + after;
                const cursorPos = before.length + sep.length + 1;
                setText(newText);
                handleTextChange(newText, cursorPos);
                setTimeout(() => {
                  cur?.focus();
                  cur?.setSelectionRange(cursorPos, cursorPos);
                }, 0);
              }}
              style={{
                padding: '2px 8px', borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontSize: '12px', fontWeight: 500,
                fontFamily: "'Inter', sans-serif", cursor: 'pointer',
              }}
            >
              / 命令
            </button>
          </div>
        ) : (
          <div /> /* 占位，保持 flex space-between 布局 */
        )}

        {/* 右侧：Debug 按钮（始终可见，断线时也能用） */}
        <div ref={debugMenuRef} style={{ position: 'relative' }}>
          {/* 弹出菜单 */}
          {debugMenuOpen && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '100%',
                right: 0,
                marginBottom: '8px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
                minWidth: '180px',
                overflow: 'hidden',
                zIndex: 50,
                animation: 'slide-up 0.15s ease both',
              }}
            >
              {/* 调试模式开关 */}
              <button
                onClick={() => { toggleDebug(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '12px 16px',
                  border: 'none',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontFamily: "'Inter', sans-serif",
                  cursor: 'pointer',
                }}
              >
                <span>调试模式</span>
                <span
                  style={{
                    width: '36px',
                    height: '20px',
                    borderRadius: '10px',
                    background: debugMode ? 'var(--accent)' : 'var(--bg-tertiary)',
                    border: `1px solid ${debugMode ? 'var(--accent)' : 'var(--border-color)'}`,
                    position: 'relative',
                    transition: 'all 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: debugMode ? '17px' : '2px',
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </span>
              </button>

              {/* 测试 Toast */}
              <button
                onClick={() => { showToast('测试消息', 'success', 1500); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                  padding: '12px 16px', border: 'none',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '13px', fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <rect x="1" y="2" width="14" height="11" rx="2" />
                  <path d="M5 8l2 2 4-4" />
                </svg>
                测试 Toast
              </button>

              {/* 测试提问弹窗 */}
              <button
                onClick={() => {
                  useSessionStore.setState({
                    pendingQuestion: {
                      requestId: 'q-test',
                      sessionId: useSessionStore.getState().currentSessionId || '',
                      question: '这是来自 Debug 菜单的手动测试提问',
                      options: [
                        { label: '弹窗正常', value: '弹窗正常' },
                        { label: '有 Bug', value: '有 Bug' },
                      ],
                    },
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                  padding: '12px 16px', border: 'none',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '13px', fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3M8 11h.01" />
                </svg>
                测试提问弹窗
              </button>

              {/* 重启服务 */}
              {restartConfirm ? (
                <div
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ flex: 1, fontSize: '13px', color: 'var(--danger)', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap' }}>
                    重启？
                  </span>
                  <button
                    onClick={handleRestart}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: "'Inter', sans-serif",
                      cursor: 'pointer',
                    }}
                  >
                    确认
                  </button>
                  <button
                    onClick={() => setRestartConfirm(false)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                      fontFamily: "'Inter', sans-serif",
                      cursor: 'pointer',
                    }}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setRestartConfirm(true)}
                  disabled={restarting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '12px 16px',
                    border: 'none',
                    background: 'transparent',
                    color: restarting ? 'var(--text-muted)' : 'var(--danger)',
                    fontSize: '13px',
                    fontFamily: "'Inter', sans-serif",
                    cursor: restarting ? 'default' : 'pointer',
                    opacity: restarting ? 0.6 : 1,
                  }}
                >
                  {restarting ? (
                    <>
                      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M14 8A6 6 0 1 1 8 2" />
                        </svg>
                      </span>
                      重启中…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 8a6 6 0 0 1 10.5-4" />
                        <path d="M14 8a6 6 0 0 1-10.5 4" />
                        <path d="M12.5 1v3.5H9" />
                        <path d="M3.5 15v-3.5H7" />
                      </svg>
                      重启服务
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Debug 按钮 */}
          <button
            onClick={() => { setDebugMenuOpen(v => !v); setRestartConfirm(false); }}
            title="调试工具"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '10px',
              border: `1px solid ${debugMode ? 'var(--warning)' : debugMenuOpen ? 'var(--accent)' : 'var(--border-color)'}`,
              background: debugMode ? 'var(--warning-bg)' : debugMenuOpen ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
              color: debugMode ? 'var(--warning)' : debugMenuOpen ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 500,
              fontFamily: "'Inter', sans-serif",
              cursor: 'pointer',
              transition: 'all 0.15s',
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
    </div>
  );
}
