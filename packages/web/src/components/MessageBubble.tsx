/**
 * 消息气泡
 * 单条消息（用户/助手），含角色标签、时间戳、对齐
 */

import React from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { ToolCallCard } from './ToolCallCard.js';
import type { Message } from '../stores/sessionStore.js';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface MessageBubbleProps {
  message: Message;
  /** 是否为最后一条消息（用于入场动画） */
  isLast?: boolean;
}

export function MessageBubble({ message, isLast }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isToolCall = !!message.toolName;
  const roleLabel = isUser ? '用户' : 'Claude';

  // 气泡公共样式
  const bubbleStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    padding: '14px 18px',
    lineHeight: 1.6,
    fontSize: '15px',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    background: isUser ? 'var(--bg-bubble-user)' : 'var(--bg-bubble-assistant)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: isUser ? '18px 18px 6px 18px' : '18px 18px 18px 6px',
  };

  return (
    <div
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
      style={{
        paddingLeft: '24px',
        paddingRight: '24px',
        marginBottom: '20px',
        animation: isLast ? 'message-enter 0.4s cubic-bezier(0.22, 1, 0.36, 1) both' : undefined,
      }}
    >
      {/* 角色行 */}
      <div
        className={`flex items-center gap-2 mb-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {/* 头像 */}
        <div
          className="flex-shrink-0 flex items-center justify-center"
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
            background: isUser ? 'linear-gradient(135deg, var(--accent), var(--accent-hover))' : 'var(--accent-soft)',
            color: isUser ? '#fff' : 'var(--accent)',
          }}
        >
          {isUser ? '你' : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="8" r="1.8" />
              <path d="M8 0.5 L8 16 M0.5 8 L15.5 8 M2.7 2.7 L13.3 13.3 M2.7 13.3 L13.3 2.7" stroke="currentColor" strokeWidth="1" opacity="0.4" />
              <path d="M8 2.5 L8 13.5 M2.5 8 L13.5 8 M4.2 4.2 L11.8 11.8 M4.2 11.8 L11.8 4.2" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            </svg>
          )}
        </div>

        <span
          className="text-xs font-semibold"
          style={{
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
            color: isUser ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {roleLabel}
        </span>

        <span
          className="text-xs"
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })}
        </span>
      </div>

      {/* 气泡内容 / 工具卡片 */}
      {isToolCall ? (
        <div className="w-full">
          <ToolCallCard
            toolCall={{
              name: message.toolName || 'Unknown',
              input: message.toolInput || {},
              result: message.toolResult,
              isError: message.isError,
              status: message.toolResult ? (message.isError ? 'error' : 'success') : 'pending',
            }}
          />
        </div>
      ) : message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="w-full">
          {message.content && (
            <div className="max-w-full mb-2" style={bubbleStyle}>
              <MarkdownRenderer content={message.content} />
            </div>
          )}
          {message.toolCalls.map((tc, i) => (
            <ToolCallCard
              key={tc.id ?? (tc.name + i)}
              toolCall={tc}
            />
          ))}
        </div>
      ) : (
        <div className="max-w-full" style={bubbleStyle}>
          <MarkdownRenderer content={message.content ?? ''} />
        </div>
      )}
    </div>
  );
}
