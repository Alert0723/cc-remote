/**
 * 流式生成指示器
 * Claude 正在输出 token 时显示呼吸动画 + 文字提示
 */

import React from 'react';

export function TypingIndicator() {
  return (
    <div
      className="flex items-start mb-5 animate-fade-in"
      style={{ paddingLeft: '24px', paddingRight: '24px' }}
    >
      {/* 头像 */}
      <div
        className="flex-shrink-0 flex items-center justify-center mr-2.5"
        style={{
          width: '26px',
          height: '26px',
          borderRadius: '8px',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          fontSize: '12px',
          fontWeight: 700,
          fontFamily: "'Inter Tight', 'Inter', sans-serif",
        }}
      >
        C
      </div>

      {/* 气泡 */}
      <div
        className="flex flex-col"
        style={{
          background: 'var(--bg-bubble-assistant)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px 14px 14px 4px',
          padding: '10px 16px',
          minWidth: '80px',
        }}
      >
        {/* 跳动圆点行 */}
        <div className="flex items-center gap-1.5" style={{ height: '12px' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block rounded-full"
              style={{
                width: '5px',
                height: '5px',
                background: 'var(--accent)',
                opacity: 0.7,
                animation: `typing-bounce 1.4s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>

        {/* 文字提示 */}
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: "'Inter', sans-serif",
            marginTop: '6px',
            letterSpacing: '0.01em',
            animation: 'breathing-text 2s ease-in-out infinite',
          }}
        >
          Claude 正在回复…
        </span>
      </div>
    </div>
  );
}
