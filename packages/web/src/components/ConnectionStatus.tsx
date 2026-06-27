/**
 * 连接状态指示器
 * 带脉冲动画的状态点 + 文字
 */

import React from 'react';
import { useConnectionStore } from '../stores/connectionStore.js';

const statusConfig = {
  connected: {
    color: 'var(--success)',
    glowColor: 'rgba(52, 211, 153, 0.4)',
    text: '已连接',
    pulse: false,
  },
  connecting: {
    color: 'var(--warning)',
    glowColor: 'rgba(245, 166, 35, 0.4)',
    text: '连接中…',
    pulse: true,
  },
  disconnected: {
    color: 'var(--danger)',
    glowColor: 'rgba(240, 71, 86, 0.4)',
    text: '已断开',
    pulse: false,
  },
} as const;

export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      {/* 状态点 */}
      <span
        className="flex-shrink-0 block rounded-full"
        style={{
          width: '8px',
          height: '8px',
          background: config.color,
          boxShadow: `0 0 6px ${config.glowColor}`,
          animation: config.pulse
            ? 'status-pulse 2s ease-in-out infinite'
            : undefined,
        }}
      />

      {/* 状态文字 */}
      <span
        className="text-xs font-medium"
        style={{
          color: 'var(--text-secondary)',
          fontFamily: "'Inter Tight', 'Inter', sans-serif",
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        {config.text}
      </span>

      {/* 断连时显示重试提示 */}
      {status === 'disconnected' && (
        <span
          className="text-xs"
          style={{
            color: 'var(--text-muted)',
            fontSize: '11px',
            fontWeight: 400,
          }}
        >
          正在重连…
        </span>
      )}
    </div>
  );
}
