/**
 * 键盘快捷键 chip
 * 统一快捷键提示的视觉样式
 */

import React from 'react';

interface KbdProps {
  children: React.ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd
      className="inline-flex items-center justify-center rounded font-mono"
      style={{
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        padding: '0 4px',
        fontSize: '10px',
        fontFamily: "'JetBrains Mono', monospace",
        height: '18px',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </kbd>
  );
}
