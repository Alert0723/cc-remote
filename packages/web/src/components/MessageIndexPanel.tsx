/**
 * 用户消息索引面板
 * 从 header 按钮触发的下拉面板，列出用户消息，点击跳转
 */

import React from 'react';
import type { Message } from '../stores/sessionStore.js';

interface MessageIndexPanelProps {
  messages: Message[];
  onScrollTo: (index: number) => void;
  onClose: () => void;
}

function cleanContent(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<system-note>[\s\S]*?<\/system-note>/gi, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/gi, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
    .replace(/<command-name>([^<]*)<\/command-name>/gi, '$1')
    .replace(/<command-message>([^<]*)<\/command-message>/gi, '')
    .replace(/<command-args>([^<]*)<\/command-args>/gi, '')
    .trim();
}

function truncate(text: string, max = 40): string {
  const cleaned = cleanContent(text);
  const plain = cleaned.replace(/[#*_`~>\[\]()!|]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return plain.slice(0, max) + '…';
}

export function MessageIndexPanel({ messages, onScrollTo, onClose }: MessageIndexPanelProps) {
  const userEntries = messages
    .map((m, i) => {
      if (m.role !== 'user' || !m.content) return null;
      const cleaned = cleanContent(m.content);
      if (!cleaned) return null; // 纯系统标签内容，不显示
      return { index: i, content: m.content };
    })
    .filter(Boolean) as { index: number; content: string }[];

  return (
    <>
      {/* 背景遮罩：点击关闭 */}
      <div
        className="fixed inset-0 z-20"
        onClick={onClose}
        style={{ background: 'transparent' }}
      />

      {/* 面板 */}
      <div
        className="absolute right-0 top-full mt-2 z-30 animate-slide-up"
        style={{
          width: 'min(340px, calc(100vw - 32px))',
          borderRadius: '16px',
          overflow: 'hidden',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-visible)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: '16px 20px 14px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              fontSize: '15px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            你的消息
          </span>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              background: 'var(--bg-tertiary)',
              padding: '2px 10px',
              borderRadius: '10px',
            }}
          >
            {userEntries.length}
          </span>
        </div>

        {/* 列表 */}
        <div style={{ maxHeight: '360px', overflowY: 'auto', overflowX: 'hidden' }}>
          {userEntries.length === 0 ? (
            <div
              style={{
                padding: '32px 20px',
                textAlign: 'center',
                fontSize: '14px',
                color: 'var(--text-muted)',
              }}
            >
              暂无消息
            </div>
          ) : (
            userEntries.map((entry, idx) => (
              <button
                key={entry.index}
                onClick={() => {
                  onScrollTo(entry.index);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: idx < userEntries.length - 1 ? '1px solid var(--border-color)' : 'none',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '14px',
                  lineHeight: 1.5,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {/* 序号标记 */}
                <span
                  style={{
                    flexShrink: 0,
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    fontFamily: "'Inter Tight', 'Inter', sans-serif",
                  }}
                >
                  {idx + 1}
                </span>

                {/* 消息文本 */}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {truncate(entry.content)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
