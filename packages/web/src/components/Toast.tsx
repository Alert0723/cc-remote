/**
 * 通用 Toast 组件
 * 底部居中，位于聊天输入框上方，带淡入向上飘入 + 淡出动画
 */

import React, { useEffect, useState } from 'react';

interface ToastProps {
  text: string;
  type: 'success' | 'error' | 'action';
  visible: boolean;
  duration?: number;
  onTap?: () => void;
  onDismiss?: () => void;
}

const COLORS: Record<string, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  action: 'var(--accent)',
};

export function Toast({ text, type, visible, duration = 1500, onTap, onDismiss }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const t = setTimeout(() => {
        setShow(false);
        setTimeout(() => onDismiss?.(), 300);
      }, duration);
      return () => clearTimeout(t);
    }
    // visible 变 false 时不立即隐藏，等 onDismiss 触发
  }, [visible, duration, onDismiss]);

  if (!visible && !show) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '110px',
        left: 0,
        right: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={onTap}
        style={{
          width: 'fit-content',
          maxWidth: '85vw',
          background: 'var(--bg-elevated)',
          color: COLORS[type],
          padding: '10px 20px',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 500,
          fontFamily: "'Inter', sans-serif",
          border: '1px solid var(--border-color)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          pointerEvents: onTap ? 'auto' : 'none',
          cursor: onTap ? 'pointer' : 'default',
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'opacity 0.3s ease, transform 0.3s ease',
        }}
      >
        {text}
      </div>
    </div>
  );
}
