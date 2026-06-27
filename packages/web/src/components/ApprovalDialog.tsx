/**
 * 权限审批弹窗组件
 * 移动端友好的底部弹出卡片，用于展示 Claude Code 的权限请求
 */

import React, { useEffect, useRef } from 'react';

interface ApprovalDialogProps {
  toolName: string;
  command?: string;
  options: ('allow' | 'deny' | 'allow_always')[];
  onApprove: (decision: 'allow' | 'deny' | 'allow_always') => void;
}

/** 工具元信息：标签、图标、对应 CSS 变量 */
interface ToolMeta { label: string; icon: React.ReactNode; colorVar: string; bgVar: string }

function getToolMeta(toolName: string): ToolMeta {
  switch (toolName) {
    case 'Bash':
      return {
        label: '终端命令',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        ),
        colorVar: 'var(--warning)',
        bgVar: 'var(--warning-bg)',
      };
    case 'Write':
    case 'Edit':
      return {
        label: '文件编辑',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        ),
        colorVar: 'var(--accent)',
        bgVar: 'var(--accent-soft)',
      };
    default:
      return {
        label: toolName,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ),
        colorVar: 'var(--text-muted)',
        bgVar: 'var(--bg-tertiary)',
      };
  }
}

export function ApprovalDialog({ toolName, command, options, onApprove }: ApprovalDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const hasAllowAlways = options.includes('allow_always');

  // 入场动画
  useEffect(() => {
    const card = overlayRef.current?.querySelector('[data-approval-card]') as HTMLElement;
    if (card) {
      requestAnimationFrame(() => {
        card.style.transform = 'translateY(0)';
        card.style.opacity = '1';
      });
    }
  }, []);

  const meta = getToolMeta(toolName);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onApprove('deny');
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        animation: 'fade-in 0.2s ease-out',
        padding: '16px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
      }}
    >
      <div
        data-approval-card
        style={{
          background: 'var(--bg-primary)',
          borderRadius: '20px',
          border: '1px solid var(--border-color)',
          padding: '24px',
          transform: 'translateY(100%)',
          opacity: 0,
          transition: 'transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.25s ease-out',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
          maxWidth: '420px',
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* 头部：图标 + 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: meta.bgVar,
              color: meta.colorVar,
              flexShrink: 0,
            }}
          >
            {meta.icon}
          </div>

          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                fontSize: '17px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
                letterSpacing: '-0.01em',
                margin: 0,
                lineHeight: 1.3,
              }}
            >
              Claude 请求权限
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: meta.bgVar,
                  color: meta.colorVar,
                }}
              >
                {toolName}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                }}
              >
                {meta.label}
              </span>
            </div>
          </div>
        </div>

        {/* 命令行内容 */}
        {command && (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '8px',
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
              }}
            >
              命令详情
            </div>
            <pre
              style={{
                background: 'var(--code-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '13px',
                lineHeight: 1.6,
                fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
                color: 'var(--text-primary)',
                overflowX: 'auto',
                overflowWrap: 'break-word',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
                maxHeight: '160px',
                overflowY: 'auto',
                margin: 0,
              }}
            >
              {command}
            </pre>
          </div>
        )}

        {/* 操作按钮 */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
          }}
        >
          {/* 拒绝 — 次要按钮 */}
          <button
            onClick={() => onApprove('deny')}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '14px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '15px',
              fontWeight: 600,
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            拒绝
          </button>

          {/* 始终允许 — 仅 options 包含 allow_always 时显示 */}
          {hasAllowAlways && (
            <button
              onClick={() => onApprove('allow_always')}
              style={{
                height: '48px',
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                background: meta.bgVar,
                color: meta.colorVar,
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: "'Inter Tight', 'Inter', sans-serif",
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 16px',
                whiteSpace: 'nowrap',
              }}
            >
              始终允许
            </button>
          )}

          {/* 允许 — 主按钮 */}
          <button
            onClick={() => onApprove('allow')}
            style={{
              flex: hasAllowAlways ? 1.5 : 1,
              height: '48px',
              borderRadius: '14px',
              border: 'none',
              background: 'var(--success)',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 700,
              fontFamily: "'Inter Tight', 'Inter', sans-serif",
              cursor: 'pointer',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 12px rgba(0, 0, 0, 0.18)',
            }}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
