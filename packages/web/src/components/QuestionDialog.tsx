/**
 * AI 提问对话框
 * 底部弹出式卡片，展示问题 + 选项按钮
 */

import React from 'react';

interface QuestionDialogProps {
  question: string;
  options: Array<{ label: string; value: string }>;
  onAnswer: (value: string) => void;
  onDismiss: () => void;
}

export function QuestionDialog({ question, options, onAnswer, onDismiss }: QuestionDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* 遮罩层 */}
      <div
        onClick={onDismiss}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          animation: 'fade-in 0.15s ease',
        }}
      />

      {/* 底部卡片 */}
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-color)',
          borderRadius: '20px 20px 0 0',
          padding: '24px 20px',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          animation: 'slide-up-from-bottom 0.25s ease',
        }}
      >
        {/* 标题 */}
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: "'Inter Tight', 'Inter', sans-serif",
            margin: '0 0 8px',
          }}
        >
          Claude 向您提问
        </h3>

        {/* 问题文本 */}
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            fontFamily: "'Inter', sans-serif",
            margin: '0 0 20px',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {question}
        </p>

        {/* 选项列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onAnswer(opt.value)}
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '15px',
                fontWeight: 500,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = 'var(--bg-tertiary)'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 底部忽略按钮 */}
        <button
          onClick={onDismiss}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '12px',
            borderRadius: '12px',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '13px',
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
          }}
        >
          忽略
        </button>
      </div>
    </div>
  );
}
