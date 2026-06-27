/**
 * 消息列表
 * 虚拟化滚动列表 + 回底按钮 + 空状态
 */

import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble.js';
import type { Message } from '../stores/sessionStore.js';

export interface MessageListHandle {
  scrollToIndex: (index: number) => void;
}

interface MessageListProps {
  messages: Message[];
  /** 是否正在流式生成 Claude 回复（在消息列表末尾显示打字动画） */
  isStreaming?: boolean;
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList({ messages, isStreaming }, ref) {
  const parentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const showBtnRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const totalCount = messages.length + (isStreaming ? 1 : 0);

  const getScrollElement = useCallback(() => parentRef.current, []);
  const estimateSize = useCallback(() => 100, []);

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement,
    estimateSize,
    overscan: 5,
  });

  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const threshold = 80;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isAtBottomRef.current = atBottom;
    const shouldShow = !atBottom && messages.length > 0;
    if (shouldShow !== showBtnRef.current) {
      showBtnRef.current = shouldShow;
      setShowScrollBtn(shouldShow);
    }
  }, [messages.length]);

  useEffect(() => {
    if (totalCount > 0 && isAtBottomRef.current) {
      virtualizerRef.current.scrollToIndex(totalCount - 1, { align: 'end' });
    }
  }, [totalCount]);

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number) => {
      virtualizer.scrollToIndex(index, { align: 'start' });
      isAtBottomRef.current = false;
      showBtnRef.current = true;
      setShowScrollBtn(true);
    },
  }), [virtualizer]);

  const scrollToBottom = useCallback(() => {
    virtualizer.scrollToIndex(totalCount - 1, { align: 'end' });
    isAtBottomRef.current = true;
    showBtnRef.current = false;
    setShowScrollBtn(false);
  }, [totalCount, virtualizer]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center px-6 text-center">
          <div
            className="flex items-center justify-center mb-5 rounded-xl"
            style={{
              width: '56px',
              height: '56px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2 style={{
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
            fontSize: '17px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}>
            暂无消息
          </h2>
          <p style={{
            fontSize: '14px',
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            maxWidth: '240px',
          }}>
            在下方输入消息，开始远程对话
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative" style={{ overflow: 'hidden' }}>
      <div
        ref={parentRef}
        className="h-full overflow-auto"
        style={{
          overflowX: 'hidden',
          paddingTop: '16px',
          paddingBottom: '16px',
        }}
        onScroll={handleScroll}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const isStreamingBubble = isStreaming && virtualItem.index === messages.length;
            if (isStreamingBubble) {
              return (
                <div
                  key="streaming-indicator"
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <StreamingBubble />
                </div>
              );
            }

            const message = messages[virtualItem.index];
            return (
              <div
                key={message.id}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <MessageBubble
                  message={message}
                  isLast={!isStreaming && virtualItem.index === messages.length - 1}
                />
              </div>
            );
          })}
        </div>
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-4 flex items-center justify-center rounded-full transition-all duration-200 animate-slide-up"
          style={{
            width: '36px',
            height: '36px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-visible)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
          title="回到底部"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  );
});

/** 流式回复的占位气泡，嵌入消息流末尾 */
function StreamingBubble() {
  return (
    <div
      className="flex flex-col items-start"
      style={{
        paddingLeft: '24px',
        paddingRight: '24px',
        marginBottom: '20px',
        animation: 'message-enter 0.3s ease both',
      }}
    >
      <div
        style={{
          background: 'var(--bg-bubble-assistant)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px 14px 14px 4px',
          padding: '12px 18px',
          minWidth: '60px',
        }}
      >
        <div className="flex items-center gap-1.5" style={{ height: '6px' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block rounded-full"
              style={{
                width: '5px',
                height: '5px',
                background: 'var(--accent)',
                opacity: 0.5,
                animation: `typing-bounce 1.2s ease-in-out ${i * 0.16}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
